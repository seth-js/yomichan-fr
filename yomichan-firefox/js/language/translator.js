/*
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* global
 * Deinflector
 * RegexUtil
 * TextSourceMap
 */

/**
 * Class which finds term and kanji dictionary entries for text.
 */
class Translator {
    /**
     * Information about how popup content should be shown, specifically related to the outer popup frame.
     * @typedef {object} TermFrequency
     * @property {string} term The term.
     * @property {string} reading The reading of the term.
     * @property {string} dictionary The name of the dictionary that the term frequency originates from.
     * @property {boolean} hasReading Whether or not a reading was specified.
     * @property {number|string} frequency The frequency value for the term.
     */

    /**
     * Creates a new Translator instance.
     * @param {object} details The details for the class.
     * @param {JapaneseUtil} details.japaneseUtil An instance of JapaneseUtil.
     * @param {DictionaryDatabase} details.database An instance of DictionaryDatabase.
     */
    constructor({japaneseUtil, database}) {
        this._japaneseUtil = japaneseUtil;
        this._database = database;
        this._deinflector = null;
        this._tagCache = new Map();
        this._stringComparer = new Intl.Collator('en-US'); // Invariant locale
        this._numberRegex = /[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
    }

    /**
     * Initializes the instance for use. The public API should not be used until
     * this function has been called.
     * @param {object} deinflectionReasons The raw deinflections reasons data that the Deinflector uses.
     */
    prepare(deinflectionReasons) {
        this._deinflector = new Deinflector(deinflectionReasons);
    }

    /**
     * Clears the database tag cache. This should be executed if the database is changed.
     */
    clearDatabaseCaches() {
        this._tagCache.clear();
    }

    /**
     * Finds term definitions for the given text.
     * @param {string} mode The mode to use for finding terms, which determines the format of the resulting array.
     *   One of: 'group', 'merge', 'split', 'simple'
     * @param {string} text The text to find terms for.
     * @param {Translation.FindTermsOptions} options A object describing settings about the lookup.
     * @returns {{dictionaryEntries: Translation.TermDictionaryEntry[], originalTextLength: number}} An object containing dictionary entries and the length of the original source text.
     */
    async findTerms(mode, text, options) {
        const {enabledDictionaryMap, excludeDictionaryDefinitions, sortFrequencyDictionary, sortFrequencyDictionaryOrder} = options;
        let {dictionaryEntries, originalTextLength} = await this._findTermsInternal(text, enabledDictionaryMap, options);

        switch (mode) {
            case 'group':
                dictionaryEntries = this._groupDictionaryEntriesByHeadword(dictionaryEntries);
                break;
            case 'merge':
                dictionaryEntries = await this._getRelatedDictionaryEntries(dictionaryEntries, options.mainDictionary, enabledDictionaryMap);
                break;
        }

        if (excludeDictionaryDefinitions !== null) {
            this._removeExcludedDefinitions(dictionaryEntries, excludeDictionaryDefinitions);
        }

        if (mode === 'simple') {
            this._clearTermTags(dictionaryEntries);
        } else {
            await this._addTermMeta(dictionaryEntries, enabledDictionaryMap);
            await this._expandTermTags(dictionaryEntries);
        }

        if (sortFrequencyDictionary !== null) {
            this._updateSortFrequencies(dictionaryEntries, sortFrequencyDictionary, sortFrequencyDictionaryOrder === 'ascending');
        }
        if (dictionaryEntries.length > 1) {
            this._sortTermDictionaryEntries(dictionaryEntries);
        }
        for (const {definitions, frequencies, pronunciations} of dictionaryEntries) {
            this._flagRedundantDefinitionTags(definitions);
            if (definitions.length > 1) { this._sortTermDictionaryEntryDefinitions(definitions); }
            if (frequencies.length > 1) { this._sortTermDictionaryEntrySimpleData(frequencies); }
            if (pronunciations.length > 1) { this._sortTermDictionaryEntrySimpleData(pronunciations); }
        }

        return {dictionaryEntries, originalTextLength};
    }

    /**
     * Finds kanji definitions for the given text.
     * @param {string} text The text to find kanji definitions for. This string can be of any length,
     *   but is typically just one character, which is a single kanji. If the string is multiple
     *   characters long, each character will be searched in the database.
     * @param {Translation.FindKanjiOptions} options A object describing settings about the lookup.
     * @returns {Translation.KanjiDictionaryEntry[]} An array of definitions. See the _createKanjiDefinition() function for structure details.
     */
    async findKanji(text, options) {
        const {enabledDictionaryMap} = options;
        const kanjiUnique = new Set();
        for (const c of text) {
            kanjiUnique.add(c);
        }

        const databaseEntries = await this._database.findKanjiBulk([...kanjiUnique], enabledDictionaryMap);
        if (databaseEntries.length === 0) { return []; }

        this._sortDatabaseEntriesByIndex(databaseEntries);

        const dictionaryEntries = [];
        for (const {character, onyomi, kunyomi, tags, definitions, stats, dictionary} of databaseEntries) {
            const expandedStats = await this._expandKanjiStats(stats, dictionary);

            const tagGroups = [];
            if (tags.length > 0) { tagGroups.push(this._createTagGroup(dictionary, tags)); }

            const dictionaryEntry = this._createKanjiDictionaryEntry(character, dictionary, onyomi, kunyomi, tagGroups, expandedStats, definitions);
            dictionaryEntries.push(dictionaryEntry);
        }

        await this._addKanjiMeta(dictionaryEntries, enabledDictionaryMap);
        await this._expandKanjiTags(dictionaryEntries);

        this._sortKanjiDictionaryEntryData(dictionaryEntries);

        return dictionaryEntries;
    }

    /**
     * Gets a list of frequency information for a given list of term-reading pairs
     * and a list of dictionaries.
     * @param {{term: string, reading: string|null}[]} termReadingList An array of `{term, reading}` pairs. If reading is null,
     *   the reading won't be compared.
     * @param {Iterable<string>} dictionaries An array of dictionary names.
     * @returns {TermFrequency[]} An array of term frequencies.
     */
    async getTermFrequencies(termReadingList, dictionaries) {
        const dictionarySet = new Set();
        for (const dictionary of dictionaries) {
            dictionarySet.add(dictionary);
        }

        const termList = termReadingList.map(({term}) => term);
        const metas = await this._database.findTermMetaBulk(termList, dictionarySet);

        const results = [];
        for (const {mode, data, dictionary, index} of metas) {
            if (mode !== 'freq') { continue; }
            let {term, reading} = termReadingList[index];
            let frequency = data;
            const hasReading = (data !== null && typeof data === 'object');
            if (hasReading) {
                if (data.reading !== reading) {
                    if (reading !== null) { continue; }
                    reading = data.reading;
                }
                frequency = data.frequency;
            }
            results.push({
                term,
                reading,
                dictionary,
                hasReading,
                frequency
            });
        }
        return results;
    }

    // Find terms internal implementation

    async _findTermsInternal(text, enabledDictionaryMap, options) {
        if (options.removeNonJapaneseCharacters) {
            text = this._getJapaneseOnlyText(text);
        }
        if (text.length === 0) {
            return {dictionaryEntries: [], originalTextLength: 0};
        }

        // Custom edits =================
        // Makes it so that Yomichan doesn't look up parts of a word, only the full word
        // Ex: находится would give me definitions for на
        // Also chop the text since words with newlines or spaces after is bugging out

        // const deinflections = await this._findTermsInternal2(text, enabledDictionaryMap, options);

        const choppedText = text.replace(/\n/g, ' ').trim();

        let deinflections = await this._findTermsInternal2(choppedText, enabledDictionaryMap, options);

        const filteredDeinflections = [];

        let smallestMatch = '';

        deinflections.forEach(flect => {
            const {originalText} = flect;

            if (!/\s/.test(originalText) 
                && /\p{L}$/u.test(originalText)
                && !smallestMatch)
                smallestMatch = originalText;
        });

        deinflections.forEach(flect => {
            const {originalText} = flect;

            if (!smallestMatch.includes(originalText) || smallestMatch === originalText) {
                filteredDeinflections.push(flect);
            }
        });

        deinflections = filteredDeinflections;

        // Automatically handle non-lemma forms by looking up what they point to
        const requiredSearches = {};
        let searching = false;

        do {
            searching = false;

            for (const {databaseEntries} of deinflections) {
                for (const ent of databaseEntries) {
                    
                    const {definitionTags, definitions, term} = ent;
                    
                    if (definitionTags.includes('non-lemma')) {
                        ent.skip = true;

                        for (const definition of definitions) {
                            const lemma = definition.replace(/.+?\(->(?=.+?\)$)/, '').replace(/\)$/, '');
                            const reason = definition.replace(/\s\(->.+/, '')

                            if (!requiredSearches[lemma]) {
                                searching = true;
                                requiredSearches[lemma] = {form: term, reasons: [reason]};
                            }
                            else if (!requiredSearches[lemma]["reasons"].includes(reason)) {
                                searching = true;
                                requiredSearches[lemma]["reasons"].push(reason);
                            }
                        }
                    }
                }
            }

            const extraDeinflections = [];

            for (const [lemma, {form, reasons}] of Object.entries(requiredSearches)) {
                const flections = await this._findTermsInternal2(lemma, enabledDictionaryMap, options);

                const filteredFlections = [];

                let smallestMatch = '';

                flections.forEach(flect => {
                    const {originalText} = flect;

                    if (!/\s/.test(originalText) 
                        && /\p{L}$/u.test(originalText)
                        && !smallestMatch)
                        smallestMatch = originalText;
                });

                flections.forEach(flect => {
                    const {originalText} = flect;

                    if (!smallestMatch.includes(originalText) || smallestMatch === originalText) {
                        filteredFlections.push(flect);
                    }
                });

                for (const flect of filteredFlections) {
                    const {databaseEntries} = flect;

                    flect['originalText'] = form;

                    databaseEntries.forEach(ent => {
                        const {definitionTags}  = ent;

                        if (definitionTags.includes('non-lemma')) ent.skip = true;
                    });

                    reasons.forEach(reason => {
                        flect.reasons.push(reason);
                    });

                    flect['isExtra'] = true;
                    extraDeinflections.push(flect);
                }
            }

            if (extraDeinflections.length > 0) deinflections.push(...extraDeinflections);
        } while (searching);

        // ==============================

        let originalTextLength = 0;
        const dictionaryEntries = [];
        const ids = new Set();
        // Custom edits =================
        // Added the isExtra variable so it can be checked
        
        // for (const {databaseEntries, originalText, transformedText, deinflectedText, reasons} of deinflections) {

        for (const {databaseEntries, originalText, transformedText, deinflectedText, reasons, isExtra} of deinflections) {

        // ==============================
            if (databaseEntries.length === 0) { continue; }

            // Custom edits =================
            // Makes it so that the character length of lemmas don't affect the non-lemma match
            // originalTextLength = Math.max(originalTextLength, originalText.length);

            if (!isExtra) {
                originalTextLength = Math.max(originalTextLength, originalText.length);
            }
            
            // ==============================
            
            for (const databaseEntry of databaseEntries) {
                const {id} = databaseEntry;
                if (ids.has(id)) { continue; }

                // Custom edits =================
                // Makes it so that non-lemma entries aren't added to the dictionary entries
                // We already have what they point to and the relevant form info

                // const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(databaseEntry, originalText, transformedText, deinflectedText, reasons, true, enabledDictionaryMap);
                // dictionaryEntries.push(dictionaryEntry);
                // ids.add(id);

                if (!databaseEntry.skip) {
                    const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(databaseEntry, originalText, transformedText, deinflectedText, reasons, true, enabledDictionaryMap);
                    dictionaryEntries.push(dictionaryEntry);
                    ids.add(id);
                }

                // ==============================
            }
        }

        return {dictionaryEntries, originalTextLength};
    }

    async _findTermsInternal2(text, enabledDictionaryMap, options) {
        const deinflections = (
            options.deinflect ?
            this._getAllDeinflections(text, options) :
            [this._createDeinflection(text, text, text, 0, [], [])]
        );
        if (deinflections.length === 0) { return []; }

        const uniqueDeinflectionTerms = [];
        const uniqueDeinflectionArrays = [];
        const uniqueDeinflectionsMap = new Map();
        for (const deinflection of deinflections) {
            const term = deinflection.deinflectedText;
            let deinflectionArray = uniqueDeinflectionsMap.get(term);
            if (typeof deinflectionArray === 'undefined') {
                deinflectionArray = [];
                uniqueDeinflectionTerms.push(term);
                uniqueDeinflectionArrays.push(deinflectionArray);
                uniqueDeinflectionsMap.set(term, deinflectionArray);
            }
            deinflectionArray.push(deinflection);
        }

        const {matchType} = options;
        const databaseEntries = await this._database.findTermsBulk(uniqueDeinflectionTerms, enabledDictionaryMap, matchType);

        for (const databaseEntry of databaseEntries) {
            const definitionRules = Deinflector.rulesToRuleFlags(databaseEntry.rules);
            for (const deinflection of uniqueDeinflectionArrays[databaseEntry.index]) {
                const deinflectionRules = deinflection.rules;
                if (deinflectionRules === 0 || (definitionRules & deinflectionRules) !== 0) {
                    deinflection.databaseEntries.push(databaseEntry);
                }
            }
        }

        return deinflections;
    }

    // Deinflections and text transformations

    _getAllDeinflections(text, options) {
        const textOptionVariantArray = [
            this._getTextReplacementsVariants(options),
            this._getTextOptionEntryVariants(options.convertHalfWidthCharacters),
            this._getTextOptionEntryVariants(options.convertNumericCharacters),
            this._getTextOptionEntryVariants(options.convertAlphabeticCharacters),
            this._getTextOptionEntryVariants(options.convertHiraganaToKatakana),
            this._getTextOptionEntryVariants(options.convertKatakanaToHiragana),
            this._getCollapseEmphaticOptions(options)
        ];

        const jp = this._japaneseUtil;
        const deinflections = [];
        const used = new Set();
        for (const [textReplacements, halfWidth, numeric, alphabetic, katakana, hiragana, [collapseEmphatic, collapseEmphaticFull]] of this._getArrayVariants(textOptionVariantArray)) {
            let text2 = text;
            const sourceMap = new TextSourceMap(text2);
            if (textReplacements !== null) {
                text2 = this._applyTextReplacements(text2, sourceMap, textReplacements);
            }
            if (halfWidth) {
                text2 = jp.convertHalfWidthKanaToFullWidth(text2, sourceMap);
            }
            if (numeric) {
                text2 = jp.convertNumericToFullWidth(text2);
            }
            if (alphabetic) {
                text2 = jp.convertAlphabeticToKana(text2, sourceMap);
            }
            if (katakana) {
                text2 = jp.convertHiraganaToKatakana(text2);
            }
            if (hiragana) {
                text2 = jp.convertKatakanaToHiragana(text2);
            }
            if (collapseEmphatic) {
                text2 = jp.collapseEmphaticSequences(text2, collapseEmphaticFull, sourceMap);
            }

            for (let i = text2.length; i > 0; --i) {
                const source = text2.substring(0, i);
                if (used.has(source)) { break; }
                used.add(source);
                const rawSource = sourceMap.source.substring(0, sourceMap.getSourceLength(i));
                for (const {term, rules, reasons} of this._deinflector.deinflect(source)) {
                    deinflections.push(this._createDeinflection(rawSource, source, term, rules, reasons, []));
                }
            }
        }
        return deinflections;
    }

    _applyTextReplacements(text, sourceMap, replacements) {
        for (const {pattern, replacement} of replacements) {
            text = RegexUtil.applyTextReplacement(text, sourceMap, pattern, replacement);
        }
        return text;
    }

    _getJapaneseOnlyText(text) {
        const jp = this._japaneseUtil;
        let length = 0;
        for (const c of text) {
            if (!jp.isCodePointJapanese(c.codePointAt(0))) {
                return text.substring(0, length);
            }
            length += c.length;
        }
        return text;
    }

    _getTextOptionEntryVariants(value) {
        switch (value) {
            case 'true': return [true];
            case 'variant': return [false, true];
            default: return [false];
        }
    }

    _getCollapseEmphaticOptions(options) {
        const collapseEmphaticOptions = [[false, false]];
        switch (options.collapseEmphaticSequences) {
            case 'true':
                collapseEmphaticOptions.push([true, false]);
                break;
            case 'full':
                collapseEmphaticOptions.push([true, false], [true, true]);
                break;
        }
        return collapseEmphaticOptions;
    }

    _getTextReplacementsVariants(options) {
        return options.textReplacements;
    }

    _createDeinflection(originalText, transformedText, deinflectedText, rules, reasons, databaseEntries) {
        return {originalText, transformedText, deinflectedText, rules, reasons, databaseEntries};
    }

    // Term dictionary entry grouping

    async _getRelatedDictionaryEntries(dictionaryEntries, mainDictionary, enabledDictionaryMap) {
        const sequenceList = [];
        const groupedDictionaryEntries = [];
        const groupedDictionaryEntriesMap = new Map();
        const ungroupedDictionaryEntriesMap = new Map();
        for (const dictionaryEntry of dictionaryEntries) {
            const {definitions: [{id, dictionary, sequences: [sequence]}]} = dictionaryEntry;
            if (mainDictionary === dictionary && sequence >= 0) {
                let group = groupedDictionaryEntriesMap.get(sequence);
                if (typeof group === 'undefined') {
                    group = {
                        ids: new Set(),
                        dictionaryEntries: []
                    };
                    sequenceList.push({query: sequence, dictionary});
                    groupedDictionaryEntries.push(group);
                    groupedDictionaryEntriesMap.set(sequence, group);
                }
                group.dictionaryEntries.push(dictionaryEntry);
                group.ids.add(id);
            } else {
                ungroupedDictionaryEntriesMap.set(id, dictionaryEntry);
            }
        }

        if (sequenceList.length > 0) {
            const secondarySearchDictionaryMap = this._getSecondarySearchDictionaryMap(enabledDictionaryMap);
            await this._addRelatedDictionaryEntries(groupedDictionaryEntries, ungroupedDictionaryEntriesMap, sequenceList, enabledDictionaryMap);
            for (const group of groupedDictionaryEntries) {
                this._sortTermDictionaryEntriesById(group.dictionaryEntries);
            }
            if (ungroupedDictionaryEntriesMap.size !== 0 || secondarySearchDictionaryMap.size !== 0) {
                await this._addSecondaryRelatedDictionaryEntries(groupedDictionaryEntries, ungroupedDictionaryEntriesMap, enabledDictionaryMap, secondarySearchDictionaryMap);
            }
        }

        const newDictionaryEntries = [];
        for (const group of groupedDictionaryEntries) {
            newDictionaryEntries.push(this._createGroupedDictionaryEntry(group.dictionaryEntries, true));
        }
        newDictionaryEntries.push(...this._groupDictionaryEntriesByHeadword(ungroupedDictionaryEntriesMap.values()));
        return newDictionaryEntries;
    }

    async _addRelatedDictionaryEntries(groupedDictionaryEntries, ungroupedDictionaryEntriesMap, sequenceList, enabledDictionaryMap) {
        const databaseEntries = await this._database.findTermsBySequenceBulk(sequenceList);
        for (const databaseEntry of databaseEntries) {
            const {dictionaryEntries, ids} = groupedDictionaryEntries[databaseEntry.index];
            const {id} = databaseEntry;
            if (ids.has(id)) { continue; }

            const {term} = databaseEntry;
            const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(databaseEntry, term, term, term, [], false, enabledDictionaryMap);
            dictionaryEntries.push(dictionaryEntry);
            ids.add(id);
            ungroupedDictionaryEntriesMap.delete(id);
        }
    }

    async _addSecondaryRelatedDictionaryEntries(groupedDictionaryEntries, ungroupedDictionaryEntriesMap, enabledDictionaryMap, secondarySearchDictionaryMap) {
        // Prepare grouping info
        const termList = [];
        const targetList = [];
        const targetMap = new Map();

        for (const group of groupedDictionaryEntries) {
            const {dictionaryEntries} = group;
            for (const dictionaryEntry of dictionaryEntries) {
                const {term, reading} = dictionaryEntry.headwords[0];
                const key = this._createMapKey([term, reading]);
                let target = targetMap.get(key);
                if (typeof target === 'undefined') {
                    target = {
                        groups: []
                    };
                    targetMap.set(key, target);
                    termList.push({term, reading});
                    targetList.push(target);
                }
                target.groups.push(group);
            }
        }

        // Group unsequenced dictionary entries with sequenced entries that have a matching [term, reading].
        for (const [id, dictionaryEntry] of ungroupedDictionaryEntriesMap.entries()) {
            const {term, reading} = dictionaryEntry.headwords[0];
            const key = this._createMapKey([term, reading]);
            const target = targetMap.get(key);
            if (typeof target === 'undefined') { continue; }

            for (const {ids, dictionaryEntries} of target.groups) {
                if (ids.has(id)) { continue; }
                dictionaryEntries.push(dictionaryEntry);
                ids.add(id);
            }
            ungroupedDictionaryEntriesMap.delete(id);
        }

        // Search database for additional secondary terms
        if (termList.length === 0 || secondarySearchDictionaryMap.size === 0) { return; }

        const databaseEntries = await this._database.findTermsExactBulk(termList, secondarySearchDictionaryMap);
        this._sortDatabaseEntriesByIndex(databaseEntries);

        for (const databaseEntry of databaseEntries) {
            const {index, id} = databaseEntry;
            const sourceText = termList[index].term;
            const target = targetList[index];
            for (const {ids, dictionaryEntries} of target.groups) {
                if (ids.has(id)) { continue; }

                const dictionaryEntry = this._createTermDictionaryEntryFromDatabaseEntry(databaseEntry, sourceText, sourceText, sourceText, [], false, enabledDictionaryMap);
                dictionaryEntries.push(dictionaryEntry);
                ids.add(id);
                ungroupedDictionaryEntriesMap.delete(id);
            }
        }
    }

    _groupDictionaryEntriesByHeadword(dictionaryEntries) {
        const groups = new Map();
        for (const dictionaryEntry of dictionaryEntries) {
            const {inflections, headwords: [{term, reading}]} = dictionaryEntry;
            const key = this._createMapKey([term, reading, ...inflections]);
            let groupDictionaryEntries = groups.get(key);
            if (typeof groupDictionaryEntries === 'undefined') {
                groupDictionaryEntries = [];
                groups.set(key, groupDictionaryEntries);
            }
            groupDictionaryEntries.push(dictionaryEntry);
        }

        const newDictionaryEntries = [];
        for (const groupDictionaryEntries of groups.values()) {
            newDictionaryEntries.push(this._createGroupedDictionaryEntry(groupDictionaryEntries, false));
        }
        return newDictionaryEntries;
    }

    // Removing data

    _removeExcludedDefinitions(dictionaryEntries, excludeDictionaryDefinitions) {
        for (let i = dictionaryEntries.length - 1; i >= 0; --i) {
            const dictionaryEntry = dictionaryEntries[i];
            const {definitions, pronunciations, frequencies, headwords} = dictionaryEntry;
            const definitionsChanged = this._removeArrayItemsWithDictionary(definitions, excludeDictionaryDefinitions);
            this._removeArrayItemsWithDictionary(pronunciations, excludeDictionaryDefinitions);
            this._removeArrayItemsWithDictionary(frequencies, excludeDictionaryDefinitions);
            this._removeTagGroupsWithDictionary(definitions, excludeDictionaryDefinitions);
            this._removeTagGroupsWithDictionary(headwords, excludeDictionaryDefinitions);

            if (!definitionsChanged) { continue; }

            if (definitions.length === 0) {
                dictionaryEntries.splice(i, 1);
            } else {
                this._removeUnusedHeadwords(dictionaryEntry);
            }
        }
    }

    _removeUnusedHeadwords(dictionaryEntry) {
        const {definitions, pronunciations, frequencies, headwords} = dictionaryEntry;
        const removeHeadwordIndices = new Set();
        for (let i = 0, ii = headwords.length; i < ii; ++i) {
            removeHeadwordIndices.add(i);
        }
        for (const {headwordIndices} of definitions) {
            for (const headwordIndex of headwordIndices) {
                removeHeadwordIndices.delete(headwordIndex);
            }
        }

        if (removeHeadwordIndices.size === 0) { return; }

        const indexRemap = new Map();
        let oldIndex = 0;
        for (let i = 0, ii = headwords.length; i < ii; ++i) {
            if (removeHeadwordIndices.has(oldIndex)) {
                headwords.splice(i, 1);
                --i;
                --ii;
            } else {
                indexRemap.set(oldIndex, indexRemap.size);
            }
            ++oldIndex;
        }

        this._updateDefinitionHeadwordIndices(definitions, indexRemap);
        this._updateArrayItemsHeadwordIndex(pronunciations, indexRemap);
        this._updateArrayItemsHeadwordIndex(frequencies, indexRemap);
    }

    _updateDefinitionHeadwordIndices(definitions, indexRemap) {
        for (const {headwordIndices} of definitions) {
            for (let i = headwordIndices.length - 1; i >= 0; --i) {
                const newHeadwordIndex = indexRemap.get(headwordIndices[i]);
                if (typeof newHeadwordIndex === 'undefined') {
                    headwordIndices.splice(i, 1);
                } else {
                    headwordIndices[i] = newHeadwordIndex;
                }
            }
        }
    }

    _updateArrayItemsHeadwordIndex(array, indexRemap) {
        for (let i = array.length - 1; i >= 0; --i) {
            const item = array[i];
            const {headwordIndex} = item;
            const newHeadwordIndex = indexRemap.get(headwordIndex);
            if (typeof newHeadwordIndex === 'undefined') {
                array.splice(i, 1);
            } else {
                item.headwordIndex = newHeadwordIndex;
            }
        }
    }

    _removeArrayItemsWithDictionary(array, excludeDictionaryDefinitions) {
        let changed = false;
        for (let j = array.length - 1; j >= 0; --j) {
            const {dictionary} = array[j];
            if (!excludeDictionaryDefinitions.has(dictionary)) { continue; }
            array.splice(j, 1);
            changed = true;
        }
        return changed;
    }

    _removeTagGroupsWithDictionary(array, excludeDictionaryDefinitions) {
        for (const {tags} of array) {
            this._removeArrayItemsWithDictionary(tags, excludeDictionaryDefinitions);
        }
    }

    // Tags

    _getTermTagTargets(dictionaryEntries) {
        const tagTargets = [];
        for (const {headwords, definitions, pronunciations} of dictionaryEntries) {
            this._addTagExpansionTargets(tagTargets, headwords);
            this._addTagExpansionTargets(tagTargets, definitions);
            for (const {pitches} of pronunciations) {
                this._addTagExpansionTargets(tagTargets, pitches);
            }
        }
        return tagTargets;
    }

    _clearTermTags(dictionaryEntries) {
        this._getTermTagTargets(dictionaryEntries);
    }

    async _expandTermTags(dictionaryEntries) {
        const tagTargets = this._getTermTagTargets(dictionaryEntries);
        await this._expandTagGroups(tagTargets);
        this._groupTags(tagTargets);
    }

    async _expandKanjiTags(dictionaryEntries) {
        const tagTargets = [];
        this._addTagExpansionTargets(tagTargets, dictionaryEntries);
        await this._expandTagGroups(tagTargets);
        this._groupTags(tagTargets);
    }

    async _expandTagGroups(tagTargets) {
        const allItems = [];
        const targetMap = new Map();
        for (const {tagGroups, tags} of tagTargets) {
            for (const {dictionary, tagNames} of tagGroups) {
                let dictionaryItems = targetMap.get(dictionary);
                if (typeof dictionaryItems === 'undefined') {
                    dictionaryItems = new Map();
                    targetMap.set(dictionary, dictionaryItems);
                }
                for (const tagName of tagNames) {
                    let item = dictionaryItems.get(tagName);
                    if (typeof item === 'undefined') {
                        const query = this._getNameBase(tagName);
                        item = {query, dictionary, tagName, cache: null, databaseTag: null, targets: []};
                        dictionaryItems.set(tagName, item);
                        allItems.push(item);
                    }
                    item.targets.push(tags);
                }
            }
        }

        const nonCachedItems = [];
        const tagCache = this._tagCache;
        for (const [dictionary, dictionaryItems] of targetMap.entries()) {
            let cache = tagCache.get(dictionary);
            if (typeof cache === 'undefined') {
                cache = new Map();
                tagCache.set(dictionary, cache);
            }
            for (const item of dictionaryItems.values()) {
                const databaseTag = cache.get(item.query);
                if (typeof databaseTag !== 'undefined') {
                    item.databaseTag = databaseTag;
                } else {
                    item.cache = cache;
                    nonCachedItems.push(item);
                }
            }
        }

        const nonCachedItemCount = nonCachedItems.length;
        if (nonCachedItemCount > 0) {
            const databaseTags = await this._database.findTagMetaBulk(nonCachedItems);
            for (let i = 0; i < nonCachedItemCount; ++i) {
                const item = nonCachedItems[i];
                let databaseTag = databaseTags[i];
                if (typeof databaseTag === 'undefined') { databaseTag = null; }
                item.databaseTag = databaseTag;
                item.cache.set(item.query, databaseTag);
            }
        }

        for (const {dictionary, tagName, databaseTag, targets} of allItems) {
            for (const tags of targets) {
                tags.push(this._createTag(databaseTag, tagName, dictionary));
            }
        }
    }

    _groupTags(tagTargets) {
        const stringComparer = this._stringComparer;
        const compare = (v1, v2) => {
            const i = v1.order - v2.order;
            return i !== 0 ? i : stringComparer.compare(v1.name, v2.name);
        };

        for (const {tags} of tagTargets) {
            if (tags.length <= 1) { continue; }
            this._mergeSimilarTags(tags);
            tags.sort(compare);
        }
    }

    _addTagExpansionTargets(tagTargets, objects) {
        for (const value of objects) {
            const tagGroups = value.tags;
            if (tagGroups.length === 0) { continue; }
            const tags = [];
            value.tags = tags;
            tagTargets.push({tagGroups, tags});
        }
    }

    _mergeSimilarTags(tags) {
        let tagCount = tags.length;
        for (let i = 0; i < tagCount; ++i) {
            const tag1 = tags[i];
            const {category, name} = tag1;
            for (let j = i + 1; j < tagCount; ++j) {
                const tag2 = tags[j];
                if (tag2.name !== name || tag2.category !== category) { continue; }
                // Merge tag
                tag1.order = Math.min(tag1.order, tag2.order);
                tag1.score = Math.max(tag1.score, tag2.score);
                tag1.dictionaries.push(...tag2.dictionaries);
                this._addUniqueSimple(tag1.content, tag2.content);
                tags.splice(j, 1);
                --tagCount;
                --j;
            }
        }
    }

    _getTagNamesWithCategory(tags, category) {
        const results = [];
        for (const tag of tags) {
            if (tag.category !== category) { continue; }
            results.push(tag.name);
        }
        results.sort();
        return results;
    }

    _flagRedundantDefinitionTags(definitions) {
        if (definitions.length === 0) { return; }

        let lastDictionary = null;
        let lastPartOfSpeech = '';
        const removeCategoriesSet = new Set();

        for (const {dictionary, tags} of definitions) {
            const partOfSpeech = this._createMapKey(this._getTagNamesWithCategory(tags, 'partOfSpeech'));

            if (lastDictionary !== dictionary) {
                lastDictionary = dictionary;
                lastPartOfSpeech = '';
            }

            if (lastPartOfSpeech === partOfSpeech) {
                removeCategoriesSet.add('partOfSpeech');
            } else {
                lastPartOfSpeech = partOfSpeech;
            }

            if (removeCategoriesSet.size > 0) {
                for (const tag of tags) {
                    if (removeCategoriesSet.has(tag.category)) {
                        tag.redundant = true;
                    }
                }
                removeCategoriesSet.clear();
            }
        }
    }

    // Metadata

    async _addTermMeta(dictionaryEntries, enabledDictionaryMap) {
        const headwordMap = new Map();
        const headwordMapKeys = [];
        const headwordReadingMaps = [];

        for (const {headwords, pronunciations, frequencies} of dictionaryEntries) {
            for (let i = 0, ii = headwords.length; i < ii; ++i) {
                const {term, reading} = headwords[i];
                let readingMap = headwordMap.get(term);
                if (typeof readingMap === 'undefined') {
                    readingMap = new Map();
                    headwordMap.set(term, readingMap);
                    headwordMapKeys.push(term);
                    headwordReadingMaps.push(readingMap);
                }
                let targets = readingMap.get(reading);
                if (typeof targets === 'undefined') {
                    targets = [];
                    readingMap.set(reading, targets);
                }
                targets.push({headwordIndex: i, pronunciations, frequencies});
            }
        }

        const metas = await this._database.findTermMetaBulk(headwordMapKeys, enabledDictionaryMap);
        for (const {mode, data, dictionary, index} of metas) {
            const {index: dictionaryIndex, priority: dictionaryPriority} = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
            const map2 = headwordReadingMaps[index];
            for (const [reading, targets] of map2.entries()) {
                switch (mode) {
                    case 'freq':
                        {
                            let frequency = data;
                            const hasReading = (data !== null && typeof data === 'object' && typeof data.reading === 'string');
                            if (hasReading) {
                                if (data.reading !== reading) { continue; }
                                frequency = data.frequency;
                            }
                            for (const {frequencies, headwordIndex} of targets) {
                                let displayValue;
                                let displayValueParsed;
                                ({frequency, displayValue, displayValueParsed} = this._getFrequencyInfo(frequency));
                                frequencies.push(this._createTermFrequency(
                                    frequencies.length,
                                    headwordIndex,
                                    dictionary,
                                    dictionaryIndex,
                                    dictionaryPriority,
                                    hasReading,
                                    frequency,
                                    displayValue,
                                    displayValueParsed
                                ));
                            }
                        }
                        break;
                    case 'pitch':
                        {
                            if (data.reading !== reading) { continue; }
                            const pitches = [];
                            for (const {position, tags, nasal, devoice} of data.pitches) {
                                const tags2 = [];
                                if (Array.isArray(tags) && tags.length > 0) {
                                    tags2.push(this._createTagGroup(dictionary, tags));
                                }
                                const nasalPositions = this._toNumberArray(nasal);
                                const devoicePositions = this._toNumberArray(devoice);
                                pitches.push({position, nasalPositions, devoicePositions, tags: tags2});
                            }
                            for (const {pronunciations, headwordIndex} of targets) {
                                pronunciations.push(this._createTermPronunciation(
                                    pronunciations.length,
                                    headwordIndex,
                                    dictionary,
                                    dictionaryIndex,
                                    dictionaryPriority,
                                    pitches
                                ));
                            }
                        }
                        break;
                }
            }
        }
    }

    async _addKanjiMeta(dictionaryEntries, enabledDictionaryMap) {
        const kanjiList = [];
        for (const {character} of dictionaryEntries) {
            kanjiList.push(character);
        }

        const metas = await this._database.findKanjiMetaBulk(kanjiList, enabledDictionaryMap);
        for (const {character, mode, data, dictionary, index} of metas) {
            const {index: dictionaryIndex, priority: dictionaryPriority} = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
            switch (mode) {
                case 'freq':
                    {
                        const {frequencies} = dictionaryEntries[index];
                        const {frequency, displayValue, displayValueParsed} = this._getFrequencyInfo(data);
                        frequencies.push(this._createKanjiFrequency(
                            frequencies.length,
                            dictionary,
                            dictionaryIndex,
                            dictionaryPriority,
                            character,
                            frequency,
                            displayValue,
                            displayValueParsed
                        ));
                    }
                    break;
            }
        }
    }

    async _expandKanjiStats(stats, dictionary) {
        const statsEntries = Object.entries(stats);
        const items = [];
        for (const [name] of statsEntries) {
            const query = this._getNameBase(name);
            items.push({query, dictionary});
        }

        const databaseInfos = await this._database.findTagMetaBulk(items);

        const statsGroups = new Map();
        for (let i = 0, ii = statsEntries.length; i < ii; ++i) {
            const databaseInfo = databaseInfos[i];
            if (databaseInfo === null) { continue; }

            const [name, value] = statsEntries[i];
            const {category} = databaseInfo;
            let group = statsGroups.get(category);
            if (typeof group === 'undefined') {
                group = [];
                statsGroups.set(category, group);
            }

            group.push(this._createKanjiStat(name, value, databaseInfo, dictionary));
        }

        const groupedStats = {};
        for (const [category, group] of statsGroups.entries()) {
            this._sortKanjiStats(group);
            groupedStats[category] = group;
        }
        return groupedStats;
    }

    _sortKanjiStats(stats) {
        if (stats.length <= 1) { return; }
        const stringComparer = this._stringComparer;
        stats.sort((v1, v2) => {
            const i = v1.order - v2.order;
            return (i !== 0) ? i : stringComparer.compare(v1.content, v2.content);
        });
    }

    _convertStringToNumber(value) {
        const match = this._numberRegex.exec(value);
        if (match === null) { return 0; }
        value = Number.parseFloat(match[0]);
        return Number.isFinite(value) ? value : 0;
    }

    _getFrequencyInfo(frequency) {
        let displayValue = null;
        let displayValueParsed = false;
        if (typeof frequency === 'object' && frequency !== null) {
            ({value: frequency, displayValue} = frequency);
            if (typeof frequency !== 'number') { frequency = 0; }
            if (typeof displayValue !== 'string') { displayValue = null; }
        } else {
            switch (typeof frequency) {
                case 'number':
                    // No change
                    break;
                case 'string':
                    displayValue = frequency;
                    displayValueParsed = true;
                    frequency = this._convertStringToNumber(frequency);
                    break;
                default:
                    frequency = 0;
                    break;
            }
        }
        return {frequency, displayValue, displayValueParsed};
    }

    // Helpers

    _getNameBase(name) {
        const pos = name.indexOf(':');
        return (pos >= 0 ? name.substring(0, pos) : name);
    }

    _getSecondarySearchDictionaryMap(enabledDictionaryMap) {
        const secondarySearchDictionaryMap = new Map();
        for (const [dictionary, details] of enabledDictionaryMap.entries()) {
            if (!details.allowSecondarySearches) { continue; }
            secondarySearchDictionaryMap.set(dictionary, details);
        }
        return secondarySearchDictionaryMap;
    }

    _getDictionaryOrder(dictionary, enabledDictionaryMap) {
        const info = enabledDictionaryMap.get(dictionary);
        const {index, priority} = typeof info !== 'undefined' ? info : {index: enabledDictionaryMap.size, priority: 0};
        return {index, priority};
    }

    *_getArrayVariants(arrayVariants) {
        const ii = arrayVariants.length;

        let total = 1;
        for (let i = 0; i < ii; ++i) {
            total *= arrayVariants[i].length;
        }

        for (let a = 0; a < total; ++a) {
            const variant = [];
            let index = a;
            for (let i = 0; i < ii; ++i) {
                const entryVariants = arrayVariants[i];
                variant.push(entryVariants[index % entryVariants.length]);
                index = Math.floor(index / entryVariants.length);
            }
            yield variant;
        }
    }

    _createMapKey(array) {
        return JSON.stringify(array);
    }

    _toNumberArray(value) {
        return Array.isArray(value) ? value : (typeof value === 'number' ? [value] : []);
    }

    // Kanji data

    _createKanjiStat(name, value, databaseInfo, dictionary) {
        const {category, notes, order, score} = databaseInfo;
        return {
            name,
            category: (typeof category === 'string' && category.length > 0 ? category : 'default'),
            content: (typeof notes === 'string' ? notes : ''),
            order: (typeof order === 'number' ? order : 0),
            score: (typeof score === 'number' ? score : 0),
            dictionary: (typeof dictionary === 'string' ? dictionary : null),
            value
        };
    }

    _createKanjiFrequency(index, dictionary, dictionaryIndex, dictionaryPriority, character, frequency, displayValue, displayValueParsed) {
        return {index, dictionary, dictionaryIndex, dictionaryPriority, character, frequency, displayValue, displayValueParsed};
    }

    _createKanjiDictionaryEntry(character, dictionary, onyomi, kunyomi, tags, stats, definitions) {
        return {
            type: 'kanji',
            character,
            dictionary,
            onyomi,
            kunyomi,
            tags,
            stats,
            definitions,
            frequencies: []
        };
    }

    // Term data

    _createTag(databaseTag, name, dictionary) {
        const {category, notes, order, score} = (databaseTag !== null ? databaseTag : {});
        return {
            name,
            category: (typeof category === 'string' && category.length > 0 ? category : 'default'),
            order: (typeof order === 'number' ? order : 0),
            score: (typeof score === 'number' ? score : 0),
            content: (typeof notes === 'string' && notes.length > 0 ? [notes] : []),
            dictionaries: [dictionary],
            redundant: false
        };
    }

    _createTagGroup(dictionary, tagNames) {
        return {dictionary, tagNames};
    }

    _createSource(originalText, transformedText, deinflectedText, matchType, matchSource, isPrimary) {
        return {originalText, transformedText, deinflectedText, matchType, matchSource, isPrimary};
    }

    _createTermHeadword(index, term, reading, sources, tags, wordClasses) {
        return {index, term, reading, sources, tags, wordClasses};
    }

    _createTermDefinition(index, headwordIndices, dictionary, dictionaryIndex, dictionaryPriority, id, score, sequences, isPrimary, tags, entries) {
        return {
            index,
            headwordIndices,
            dictionary,
            dictionaryIndex,
            dictionaryPriority,
            id,
            score,
            frequencyOrder: 0,
            sequences,
            isPrimary,
            tags,
            entries
        };
    }

    _createTermPronunciation(index, headwordIndex, dictionary, dictionaryIndex, dictionaryPriority, pitches) {
        return {index, headwordIndex, dictionary, dictionaryIndex, dictionaryPriority, pitches};
    }

    _createTermFrequency(index, headwordIndex, dictionary, dictionaryIndex, dictionaryPriority, hasReading, frequency, displayValue, displayValueParsed) {
        return {index, headwordIndex, dictionary, dictionaryIndex, dictionaryPriority, hasReading, frequency, displayValue, displayValueParsed};
    }

    _createTermDictionaryEntry(isPrimary, inflections, score, dictionaryIndex, dictionaryPriority, sourceTermExactMatchCount, maxTransformedTextLength, headwords, definitions) {
        return {
            type: 'term',
            isPrimary,
            inflections,
            score,
            frequencyOrder: 0,
            dictionaryIndex,
            dictionaryPriority,
            sourceTermExactMatchCount,
            maxTransformedTextLength,
            headwords,
            definitions,
            pronunciations: [],
            frequencies: []
        };
    }

    _createTermDictionaryEntryFromDatabaseEntry(databaseEntry, originalText, transformedText, deinflectedText, reasons, isPrimary, enabledDictionaryMap) {
        const {matchType, matchSource, term, reading: rawReading, definitionTags, termTags, definitions, score, dictionary, id, sequence: rawSequence, rules} = databaseEntry;
        const reading = (rawReading.length > 0 ? rawReading : term);
        const {index: dictionaryIndex, priority: dictionaryPriority} = this._getDictionaryOrder(dictionary, enabledDictionaryMap);
        const sourceTermExactMatchCount = (isPrimary && deinflectedText === term ? 1 : 0);
        const source = this._createSource(originalText, transformedText, deinflectedText, matchType, matchSource, isPrimary);
        const maxTransformedTextLength = transformedText.length;
        const hasSequence = (rawSequence >= 0);
        const sequence = hasSequence ? rawSequence : -1;

        const headwordTagGroups = [];
        const definitionTagGroups = [];
        if (termTags.length > 0) { headwordTagGroups.push(this._createTagGroup(dictionary, termTags)); }
        if (definitionTags.length > 0) { definitionTagGroups.push(this._createTagGroup(dictionary, definitionTags)); }

        return this._createTermDictionaryEntry(
            isPrimary,
            reasons,
            score,
            dictionaryIndex,
            dictionaryPriority,
            sourceTermExactMatchCount,
            maxTransformedTextLength,
            [this._createTermHeadword(0, term, reading, [source], headwordTagGroups, rules)],
            [this._createTermDefinition(0, [0], dictionary, dictionaryIndex, dictionaryPriority, id, score, [sequence], isPrimary, definitionTagGroups, definitions)]
        );
    }

    _createGroupedDictionaryEntry(dictionaryEntries, checkDuplicateDefinitions) {
        // Headwords are generated before sorting, so that the order of dictionaryEntries can be maintained
        const definitionEntries = [];
        const headwords = new Map();
        for (const dictionaryEntry of dictionaryEntries) {
            const headwordIndexMap = this._addTermHeadwords(headwords, dictionaryEntry.headwords);
            definitionEntries.push({index: definitionEntries.length, dictionaryEntry, headwordIndexMap});
        }

        // Sort
        if (definitionEntries.length <= 1) {
            checkDuplicateDefinitions = false;
        }

        // Merge dictionary entry data
        let score = Number.MIN_SAFE_INTEGER;
        let dictionaryIndex = Number.MAX_SAFE_INTEGER;
        let dictionaryPriority = Number.MIN_SAFE_INTEGER;
        let maxTransformedTextLength = 0;
        let isPrimary = false;
        const definitions = [];
        const definitionsMap = checkDuplicateDefinitions ? new Map() : null;
        let inflections = null;

        for (const {dictionaryEntry, headwordIndexMap} of definitionEntries) {
            score = Math.max(score, dictionaryEntry.score);
            dictionaryIndex = Math.min(dictionaryIndex, dictionaryEntry.dictionaryIndex);
            dictionaryPriority = Math.max(dictionaryPriority, dictionaryEntry.dictionaryPriority);
            if (dictionaryEntry.isPrimary) {
                isPrimary = true;
                maxTransformedTextLength = Math.max(maxTransformedTextLength, dictionaryEntry.maxTransformedTextLength);
                const dictionaryEntryInflections = dictionaryEntry.inflections;
                if (inflections === null || dictionaryEntryInflections.length < inflections.length) {
                    inflections = dictionaryEntryInflections;
                }
            }
            if (checkDuplicateDefinitions) {
                this._addTermDefinitions(definitions, definitionsMap, dictionaryEntry.definitions, headwordIndexMap);
            } else {
                this._addTermDefinitionsFast(definitions, dictionaryEntry.definitions, headwordIndexMap);
            }
        }

        const headwordsArray = [...headwords.values()];

        let sourceTermExactMatchCount = 0;
        for (const {sources} of headwordsArray) {
            for (const source of sources) {
                if (source.isPrimary && source.matchSource === 'term') {
                    ++sourceTermExactMatchCount;
                    break;
                }
            }
        }

        return this._createTermDictionaryEntry(
            isPrimary,
            inflections !== null ? inflections : [],
            score,
            dictionaryIndex,
            dictionaryPriority,
            sourceTermExactMatchCount,
            maxTransformedTextLength,
            headwordsArray,
            definitions
        );
    }

    // Data collection addition functions

    _addUniqueSimple(list, newItems) {
        for (const item of newItems) {
            if (!list.includes(item)) {
                list.push(item);
            }
        }
    }

    _addUniqueSources(sources, newSources) {
        if (newSources.length === 0) { return; }
        if (sources.length === 0) {
            sources.push(...newSources);
            return;
        }
        for (const newSource of newSources) {
            const {originalText, transformedText, deinflectedText, matchType, matchSource, isPrimary} = newSource;
            let has = false;
            for (const source of sources) {
                if (
                    source.deinflectedText === deinflectedText &&
                    source.transformedText === transformedText &&
                    source.originalText === originalText &&
                    source.matchType === matchType &&
                    source.matchSource === matchSource
                ) {
                    if (isPrimary) { source.isPrimary = true; }
                    has = true;
                    break;
                }
            }
            if (!has) {
                sources.push(newSource);
            }
        }
    }

    _addUniqueTagGroups(tagGroups, newTagGroups) {
        if (newTagGroups.length === 0) { return; }
        for (const newTagGroup of newTagGroups) {
            const {dictionary} = newTagGroup;
            const ii = tagGroups.length;
            if (ii > 0) {
                let i = 0;
                for (; i < ii; ++i) {
                    const tagGroup = tagGroups[i];
                    if (tagGroup.dictionary === dictionary) {
                        this._addUniqueSimple(tagGroup.tagNames, newTagGroup.tagNames);
                        break;
                    }
                }
                if (i < ii) { continue; }
            }
            tagGroups.push(newTagGroup);
        }
    }

    _addTermHeadwords(headwordsMap, headwords) {
        const headwordIndexMap = [];
        for (const {term, reading, sources, tags, wordClasses} of headwords) {
            const key = this._createMapKey([term, reading]);
            let headword = headwordsMap.get(key);
            if (typeof headword === 'undefined') {
                headword = this._createTermHeadword(headwordsMap.size, term, reading, [], [], []);
                headwordsMap.set(key, headword);
            }
            this._addUniqueSources(headword.sources, sources);
            this._addUniqueTagGroups(headword.tags, tags);
            this._addUniqueSimple(headword.wordClasses, wordClasses);
            headwordIndexMap.push(headword.index);
        }
        return headwordIndexMap;
    }

    _addUniqueTermHeadwordIndex(headwordIndices, headwordIndex) {
        let end = headwordIndices.length;
        if (end === 0) {
            headwordIndices.push(headwordIndex);
            return;
        }

        let start = 0;
        while (start < end) {
            const mid = Math.floor((start + end) / 2);
            const value = headwordIndices[mid];
            if (headwordIndex === value) { return; }
            if (headwordIndex > value) {
                start = mid + 1;
            } else {
                end = mid;
            }
        }

        if (headwordIndex === headwordIndices[start]) { return; }
        headwordIndices.splice(start, 0, headwordIndex);
    }

    _addTermDefinitionsFast(definitions, newDefinitions, headwordIndexMap) {
        for (const {headwordIndices, dictionary, dictionaryIndex, dictionaryPriority, sequences, id, score, isPrimary, tags, entries} of newDefinitions) {
            const headwordIndicesNew = [];
            for (const headwordIndex of headwordIndices) {
                headwordIndicesNew.push(headwordIndexMap[headwordIndex]);
            }
            definitions.push(this._createTermDefinition(definitions.length, headwordIndicesNew, dictionary, dictionaryIndex, dictionaryPriority, id, score, sequences, isPrimary, tags, entries));
        }
    }

    _addTermDefinitions(definitions, definitionsMap, newDefinitions, headwordIndexMap) {
        for (const {headwordIndices, dictionary, dictionaryIndex, dictionaryPriority, sequences, id, score, isPrimary, tags, entries} of newDefinitions) {
            const key = this._createMapKey([dictionary, ...entries]);
            let definition = definitionsMap.get(key);
            if (typeof definition === 'undefined') {
                definition = this._createTermDefinition(definitions.length, [], dictionary, dictionaryIndex, dictionaryPriority, id, score, [...sequences], isPrimary, [], [...entries]);
                definitions.push(definition);
                definitionsMap.set(key, definition);
            } else {
                if (isPrimary) {
                    definition.isPrimary = true;
                }
                this._addUniqueSimple(definition.sequences, sequences);
            }

            const newHeadwordIndices = definition.headwordIndices;
            for (const headwordIndex of headwordIndices) {
                this._addUniqueTermHeadwordIndex(newHeadwordIndices, headwordIndexMap[headwordIndex]);
            }
            this._addUniqueTagGroups(definition.tags, tags);
        }
    }

    // Sorting functions

    _sortDatabaseEntriesByIndex(databaseEntries) {
        if (databaseEntries.length <= 1) { return; }
        databaseEntries.sort((a, b) => a.index - b.index);
    }

    _sortTermDictionaryEntries(dictionaryEntries) {
        const stringComparer = this._stringComparer;
        const compareFunction = (v1, v2) => {
            // Sort by length of source term
            let i = v2.maxTransformedTextLength - v1.maxTransformedTextLength;
            if (i !== 0) { return i; }

            // Sort by the number of inflection reasons
            i = v1.inflections.length - v2.inflections.length;
            if (i !== 0) { return i; }

            // Sort by how many terms exactly match the source (e.g. for exact kana prioritization)
            i = v2.sourceTermExactMatchCount - v1.sourceTermExactMatchCount;
            if (i !== 0) { return i; }

            // Sort by frequency order
            i = v1.frequencyOrder - v2.frequencyOrder;
            if (i !== 0) { return i; }

            // Sort by dictionary priority
            i = v2.dictionaryPriority - v1.dictionaryPriority;
            if (i !== 0) { return i; }

            // Sort by term score
            i = v2.score - v1.score;
            if (i !== 0) { return i; }

            // Sort by headword term text
            const headwords1 = v1.headwords;
            const headwords2 = v2.headwords;
            for (let j = 0, jj = Math.min(headwords1.length, headwords2.length); j < jj; ++j) {
                const term1 = headwords1[j].term;
                const term2 = headwords2[j].term;

                i = term2.length - term1.length;
                if (i !== 0) { return i; }

                i = stringComparer.compare(term1, term2);
                if (i !== 0) { return i; }
            }

            // Sort by definition count
            i = v2.definitions.length - v1.definitions.length;
            if (i !== 0) { return i; }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            return i;
        };
        dictionaryEntries.sort(compareFunction);
    }

    _sortTermDictionaryEntryDefinitions(definitions) {
        const compareFunction = (v1, v2) => {
            // Sort by frequency order
            let i = v1.frequencyOrder - v2.frequencyOrder;
            if (i !== 0) { return i; }

            // Sort by dictionary priority
            i = v2.dictionaryPriority - v1.dictionaryPriority;
            if (i !== 0) { return i; }

            // Sort by term score
            i = v2.score - v1.score;
            if (i !== 0) { return i; }

            // Sort by definition headword index
            const headwordIndices1 = v1.headwordIndices;
            const headwordIndices2 = v2.headwordIndices;
            const jj = headwordIndices1.length;
            i = headwordIndices2.length - jj;
            if (i !== 0) { return i; }
            for (let j = 0; j < jj; ++j) {
                i = headwordIndices1[j] - headwordIndices2[j];
                if (i !== 0) { return i; }
            }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) { return i; }

            // Sort by original order
            i = v1.index - v2.index;
            return i;
        };
        definitions.sort(compareFunction);
    }

    _sortTermDictionaryEntriesById(dictionaryEntries) {
        if (dictionaryEntries.length <= 1) { return; }
        dictionaryEntries.sort((a, b) => a.definitions[0].id - b.definitions[0].id);
    }

    _sortTermDictionaryEntrySimpleData(dataList) {
        const compare = (v1, v2) => {
            // Sort by dictionary priority
            let i = v2.dictionaryPriority - v1.dictionaryPriority;
            if (i !== 0) { return i; }

            // Sory by headword order
            i = v1.headwordIndex - v2.headwordIndex;
            if (i !== 0) { return i; }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) { return i; }

            // Default order
            i = v1.index - v2.index;
            return i;
        };
        dataList.sort(compare);
    }

    _sortKanjiDictionaryEntryData(dictionaryEntries) {
        const compare = (v1, v2) => {
            // Sort by dictionary priority
            let i = v2.dictionaryPriority - v1.dictionaryPriority;
            if (i !== 0) { return i; }

            // Sort by dictionary order
            i = v1.dictionaryIndex - v2.dictionaryIndex;
            if (i !== 0) { return i; }

            // Default order
            i = v1.index - v2.index;
            return i;
        };

        for (const {frequencies} of dictionaryEntries) {
            frequencies.sort(compare);
        }
    }

    _updateSortFrequencies(dictionaryEntries, dictionary, ascending) {
        const frequencyMap = new Map();
        for (const dictionaryEntry of dictionaryEntries) {
            const {definitions, frequencies} = dictionaryEntry;
            let frequencyMin = Number.MAX_SAFE_INTEGER;
            let frequencyMax = Number.MIN_SAFE_INTEGER;
            for (const item of frequencies) {
                if (item.dictionary !== dictionary) { continue; }
                const {headwordIndex, frequency} = item;
                if (typeof frequency !== 'number') { continue; }
                frequencyMap.set(headwordIndex, frequency);
                frequencyMin = Math.min(frequencyMin, frequency);
                frequencyMax = Math.max(frequencyMax, frequency);
            }
            dictionaryEntry.frequencyOrder = (
                frequencyMin <= frequencyMax ?
                (ascending ? frequencyMin : -frequencyMax) :
                (ascending ? Number.MAX_SAFE_INTEGER : 0)
            );
            for (const definition of definitions) {
                frequencyMin = Number.MAX_SAFE_INTEGER;
                frequencyMax = Number.MIN_SAFE_INTEGER;
                const {headwordIndices} = definition;
                for (const headwordIndex of headwordIndices) {
                    const frequency = frequencyMap.get(headwordIndex);
                    if (typeof frequency !== 'number') { continue; }
                    frequencyMin = Math.min(frequencyMin, frequency);
                    frequencyMax = Math.max(frequencyMax, frequency);
                }
                definition.frequencyOrder = (
                    frequencyMin <= frequencyMax ?
                    (ascending ? frequencyMin : -frequencyMax) :
                    (ascending ? Number.MAX_SAFE_INTEGER : 0)
                );
            }
            frequencyMap.clear();
        }
    }
}
