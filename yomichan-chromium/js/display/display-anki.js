/*
 * Copyright (C) 2021-2022  Yomichan Authors
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
 * AnkiNoteBuilder
 * AnkiUtil
 * PopupMenu
 */

class DisplayAnki {
    constructor(display, displayAudio, japaneseUtil) {
        this._display = display;
        this._displayAudio = displayAudio;
        this._ankiFieldTemplates = null;
        this._ankiFieldTemplatesDefault = null;
        this._ankiNoteBuilder = new AnkiNoteBuilder({japaneseUtil});
        this._errorNotification = null;
        this._errorNotificationEventListeners = null;
        this._tagsNotification = null;
        this._updateAdderButtonsPromise = Promise.resolve();
        this._updateDictionaryEntryDetailsToken = null;
        this._eventListeners = new EventListenerCollection();
        this._dictionaryEntryDetails = null;
        this._noteContext = null;
        this._checkForDuplicates = false;
        this._suspendNewCards = false;
        this._compactTags = false;
        this._resultOutputMode = 'split';
        this._glossaryLayoutMode = 'default';
        this._displayTags = 'never';
        this._duplicateScope = 'collection';
        this._duplicateScopeCheckAllModels = false;
        this._screenshotFormat = 'png';
        this._screenshotQuality = 100;
        this._scanLength = 10;
        this._noteGuiMode = 'browse';
        this._audioDownloadIdleTimeout = null;
        this._noteTags = [];
        this._modeOptions = new Map();
        this._dictionaryEntryTypeModeMap = new Map([
            ['kanji', ['kanji']],
            ['term', ['term-kanji', 'term-kana']]
        ]);
        this._menuContainer = document.querySelector('#popup-menus');
        this._onShowTagsBind = this._onShowTags.bind(this);
        this._onNoteAddBind = this._onNoteAdd.bind(this);
        this._onViewNoteButtonClickBind = this._onViewNoteButtonClick.bind(this);
        this._onViewNoteButtonContextMenuBind = this._onViewNoteButtonContextMenu.bind(this);
        this._onViewNoteButtonMenuCloseBind = this._onViewNoteButtonMenuClose.bind(this);
    }

    prepare() {
        this._noteContext = this._getNoteContext();
        this._display.hotkeyHandler.registerActions([
            ['addNoteKanji',      () => { this._tryAddAnkiNoteForSelectedEntry('kanji'); }],
            ['addNoteTermKanji',  () => { this._tryAddAnkiNoteForSelectedEntry('term-kanji'); }],
            ['addNoteTermKana',   () => { this._tryAddAnkiNoteForSelectedEntry('term-kana'); }],
            ['viewNote',          this._viewNoteForSelectedEntry.bind(this)]
        ]);
        this._display.on('optionsUpdated', this._onOptionsUpdated.bind(this));
        this._display.on('contentClear', this._onContentClear.bind(this));
        this._display.on('contentUpdateStart', this._onContentUpdateStart.bind(this));
        this._display.on('contentUpdateEntry', this._onContentUpdateEntry.bind(this));
        this._display.on('contentUpdateComplete', this._onContentUpdateComplete.bind(this));
        this._display.on('logDictionaryEntryData', this._onLogDictionaryEntryData.bind(this));
    }

    async getLogData(dictionaryEntry) {
        const result = {};

        // Anki note data
        let ankiNoteData;
        let ankiNoteDataException;
        try {
            ankiNoteData = await this._ankiNoteBuilder.getRenderingData({
                dictionaryEntry,
                mode: 'test',
                context: this._noteContext,
                resultOutputMode: this._resultOutputMode,
                glossaryLayoutMode: this._glossaryLayoutMode,
                compactTags: this._compactTags,
                marker: 'test'
            });
        } catch (e) {
            ankiNoteDataException = e;
        }
        result.ankiNoteData = ankiNoteData;
        if (typeof ankiNoteDataException !== 'undefined') {
            result.ankiNoteDataException = ankiNoteDataException;
        }

        // Anki notes
        const ankiNotes = [];
        const modes = this._getModes(dictionaryEntry.type === 'term');
        for (const mode of modes) {
            let note;
            let errors;
            let requirements;
            try {
                ({note: note, errors, requirements} = await this._createNote(dictionaryEntry, mode, []));
            } catch (e) {
                errors = [e];
            }
            const entry = {mode, note};
            if (Array.isArray(errors) && errors.length > 0) {
                entry.errors = errors;
            }
            if (Array.isArray(requirements) && requirements.length > 0) {
                entry.requirements = requirements;
            }
            ankiNotes.push(entry);
        }
        result.ankiNotes = ankiNotes;

        return result;
    }

    // Private

    _onOptionsUpdated({options}) {
        const {
            general: {resultOutputMode, glossaryLayoutMode, compactTags},
            anki: {
                tags,
                duplicateScope,
                duplicateScopeCheckAllModels,
                suspendNewCards,
                checkForDuplicates,
                displayTags,
                kanji,
                terms,
                noteGuiMode,
                screenshot: {format, quality},
                downloadTimeout
            },
            scanning: {length: scanLength}
        } = options;

        this._checkForDuplicates = checkForDuplicates;
        this._suspendNewCards = suspendNewCards;
        this._compactTags = compactTags;
        this._resultOutputMode = resultOutputMode;
        this._glossaryLayoutMode = glossaryLayoutMode;
        this._displayTags = displayTags;
        this._duplicateScope = duplicateScope;
        this._duplicateScopeCheckAllModels = duplicateScopeCheckAllModels;
        this._screenshotFormat = format;
        this._screenshotQuality = quality;
        this._scanLength = scanLength;
        this._noteGuiMode = noteGuiMode;
        this._noteTags = [...tags];
        this._audioDownloadIdleTimeout = (Number.isFinite(downloadTimeout) && downloadTimeout > 0 ? downloadTimeout : null);
        this._modeOptions.clear();
        this._modeOptions.set('kanji', kanji);
        this._modeOptions.set('term-kanji', terms);
        this._modeOptions.set('term-kana', terms);

        this._updateAnkiFieldTemplates(options);
    }

    _onContentClear() {
        this._updateDictionaryEntryDetailsToken = null;
        this._dictionaryEntryDetails = null;
        this._hideErrorNotification(false);
    }

    _onContentUpdateStart() {
        this._noteContext = this._getNoteContext();
    }

    _onContentUpdateEntry({element}) {
        const eventListeners = this._eventListeners;
        for (const node of element.querySelectorAll('.action-button[data-action=view-tags]')) {
            eventListeners.addEventListener(node, 'click', this._onShowTagsBind);
        }
        for (const node of element.querySelectorAll('.action-button[data-action=add-note]')) {
            eventListeners.addEventListener(node, 'click', this._onNoteAddBind);
        }
        for (const node of element.querySelectorAll('.action-button[data-action=view-note]')) {
            eventListeners.addEventListener(node, 'click', this._onViewNoteButtonClickBind);
            eventListeners.addEventListener(node, 'contextmenu', this._onViewNoteButtonContextMenuBind);
            eventListeners.addEventListener(node, 'menuClose', this._onViewNoteButtonMenuCloseBind);
        }
    }

    _onContentUpdateComplete() {
        this._updateDictionaryEntryDetails();
    }

    _onLogDictionaryEntryData({dictionaryEntry, promises}) {
        promises.push(this.getLogData(dictionaryEntry));
    }

    _onNoteAdd(e) {
        e.preventDefault();
        const node = e.currentTarget;
        const index = this._display.getElementDictionaryEntryIndex(node);
        this._addAnkiNote(index, node.dataset.mode);
    }

    _onShowTags(e) {
        e.preventDefault();
        const tags = e.currentTarget.title;
        this._showTagsNotification(tags);
    }

    _adderButtonFind(index, mode) {
        const entry = this._getEntry(index);
        return entry !== null ? entry.querySelector(`.action-button[data-action=add-note][data-mode="${mode}"]`) : null;
    }

    _tagsIndicatorFind(index) {
        const entry = this._getEntry(index);
        return entry !== null ? entry.querySelector('.action-button[data-action=view-tags]') : null;
    }

    _getEntry(index) {
        const entries = this._display.dictionaryEntryNodes;
        return index >= 0 && index < entries.length ? entries[index] : null;
    }

    _getNoteContext() {
        const {state} = this._display.history;
        let {documentTitle, url, sentence} = (isObject(state) ? state : {});
        if (typeof documentTitle !== 'string') {
            documentTitle = document.title;
        }
        if (typeof url !== 'string') {
            url = window.location.href;
        }
        const {query, fullQuery, queryOffset} = this._display;
        sentence = this._getValidSentenceData(sentence, fullQuery, queryOffset);
        return {
            url,
            sentence,
            documentTitle,
            query,
            fullQuery
        };
    }

    async _updateDictionaryEntryDetails() {
        const {dictionaryEntries} = this._display;
        const token = {};
        this._updateDictionaryEntryDetailsToken = token;
        if (this._updateAdderButtonsPromise !== null) {
            await this._updateAdderButtonsPromise;
        }
        if (this._updateDictionaryEntryDetailsToken !== token) { return; }

        const {promise, resolve} = deferPromise();
        try {
            this._updateAdderButtonsPromise = promise;
            const dictionaryEntryDetails = await this._getDictionaryEntryDetails(dictionaryEntries);
            if (this._updateDictionaryEntryDetailsToken !== token) { return; }
            this._dictionaryEntryDetails = dictionaryEntryDetails;
            this._updateAdderButtons();
        } finally {
            resolve();
            if (this._updateAdderButtonsPromise === promise) {
                this._updateAdderButtonsPromise = null;
            }
        }
    }

    _updateAdderButtons() {
        const displayTags = this._displayTags;
        const dictionaryEntryDetails = this._dictionaryEntryDetails;
        for (let i = 0, ii = dictionaryEntryDetails.length; i < ii; ++i) {
            let allNoteIds = null;
            for (const {mode, canAdd, noteIds, noteInfos, ankiError} of dictionaryEntryDetails[i].modeMap.values()) {
                const button = this._adderButtonFind(i, mode);
                if (button !== null) {
                    button.disabled = !canAdd;
                    button.hidden = (ankiError !== null);
                }

                if (Array.isArray(noteIds) && noteIds.length > 0) {
                    if (allNoteIds === null) { allNoteIds = new Set(); }
                    for (const noteId of noteIds) { allNoteIds.add(noteId); }
                }

                if (displayTags !== 'never' && Array.isArray(noteInfos)) {
                    this._setupTagsIndicator(i, noteInfos);
                }
            }
            this._updateViewNoteButton(i, allNoteIds !== null ? [...allNoteIds] : [], false);
        }
    }

    _setupTagsIndicator(i, noteInfos) {
        const tagsIndicator = this._tagsIndicatorFind(i);
        if (tagsIndicator === null) {
            return;
        }

        const displayTags = new Set();
        for (const {tags} of noteInfos) {
            for (const tag of tags) {
                displayTags.add(tag);
            }
        }
        if (this._displayTags === 'non-standard') {
            for (const tag of this._noteTags) {
                displayTags.delete(tag);
            }
        }

        if (displayTags.size > 0) {
            tagsIndicator.disabled = false;
            tagsIndicator.hidden = false;
            tagsIndicator.title = `Card tags: ${[...displayTags].join(', ')}`;
        }
    }

    _showTagsNotification(message) {
        if (this._tagsNotification === null) {
            this._tagsNotification = this._display.createNotification(true);
        }

        this._tagsNotification.setContent(message);
        this._tagsNotification.open();
    }

    _tryAddAnkiNoteForSelectedEntry(mode) {
        const index = this._display.selectedIndex;
        this._addAnkiNote(index, mode);
    }

    async _addAnkiNote(dictionaryEntryIndex, mode) {
        const dictionaryEntries = this._display.dictionaryEntries;
        const dictionaryEntryDetails = this._dictionaryEntryDetails;
        if (!(
            dictionaryEntryDetails !== null &&
            dictionaryEntryIndex >= 0 &&
            dictionaryEntryIndex < dictionaryEntries.length &&
            dictionaryEntryIndex < dictionaryEntryDetails.length
        )) {
            return;
        }
        const dictionaryEntry = dictionaryEntries[dictionaryEntryIndex];
        const details = dictionaryEntryDetails[dictionaryEntryIndex].modeMap.get(mode);
        if (typeof details === 'undefined') { return; }

        const {requirements} = details;

        const button = this._adderButtonFind(dictionaryEntryIndex, mode);
        if (button === null || button.disabled) { return; }

        this._hideErrorNotification(true);

        const allErrors = [];
        const progressIndicatorVisible = this._display.progressIndicatorVisible;
        const overrideToken = progressIndicatorVisible.setOverride(true);
        try {
            const {note, errors, requirements: outputRequirements} = await this._createNote(dictionaryEntry, mode, requirements);
            allErrors.push(...errors);

            const error = this._getAddNoteRequirementsError(requirements, outputRequirements);
            if (error !== null) { allErrors.push(error); }

            let noteId = null;
            let addNoteOkay = false;
            try {
                noteId = await yomichan.api.addAnkiNote(note);
                addNoteOkay = true;
            } catch (e) {
                allErrors.length = 0;
                allErrors.push(e);
            }

            if (addNoteOkay) {
                if (noteId === null) {
                    allErrors.push(new Error('Note could not be added'));
                } else {
                    if (this._suspendNewCards) {
                        try {
                            await yomichan.api.suspendAnkiCardsForNote(noteId);
                        } catch (e) {
                            allErrors.push(e);
                        }
                    }
                    button.disabled = true;
                    this._updateViewNoteButton(dictionaryEntryIndex, [noteId], true);
                }
            }
        } catch (e) {
            allErrors.push(e);
        } finally {
            progressIndicatorVisible.clearOverride(overrideToken);
        }

        if (allErrors.length > 0) {
            this._showErrorNotification(allErrors);
        } else {
            this._hideErrorNotification(true);
        }
    }

    _getAddNoteRequirementsError(requirements, outputRequirements) {
        if (outputRequirements.length === 0) { return null; }

        let count = 0;
        for (const requirement of outputRequirements) {
            const {type} = requirement;
            switch (type) {
                case 'audio':
                case 'clipboardImage':
                    break;
                default:
                    ++count;
                    break;
            }
        }
        if (count === 0) { return null; }

        const error = new Error('The created card may not have some content');
        error.requirements = requirements;
        error.outputRequirements = outputRequirements;
        return error;
    }

    _showErrorNotification(errors, displayErrors) {
        if (typeof displayErrors === 'undefined') { displayErrors = errors; }

        if (this._errorNotificationEventListeners !== null) {
            this._errorNotificationEventListeners.removeAllEventListeners();
        }

        if (this._errorNotification === null) {
            this._errorNotification = this._display.createNotification(false);
            this._errorNotificationEventListeners = new EventListenerCollection();
        }

        const content = this._display.displayGenerator.createAnkiNoteErrorsNotificationContent(displayErrors);
        for (const node of content.querySelectorAll('.anki-note-error-log-link')) {
            this._errorNotificationEventListeners.addEventListener(node, 'click', () => {
                console.log({ankiNoteErrors: errors});
            }, false);
        }

        this._errorNotification.setContent(content);
        this._errorNotification.open();
    }

    _hideErrorNotification(animate) {
        if (this._errorNotification === null) { return; }
        this._errorNotification.close(animate);
        this._errorNotificationEventListeners.removeAllEventListeners();
    }

    async _updateAnkiFieldTemplates(options) {
        this._ankiFieldTemplates = await this._getAnkiFieldTemplates(options);
    }

    async _getAnkiFieldTemplates(options) {
        let templates = options.anki.fieldTemplates;
        if (typeof templates === 'string') { return templates; }

        templates = this._ankiFieldTemplatesDefault;
        if (typeof templates === 'string') { return templates; }

        templates = await yomichan.api.getDefaultAnkiFieldTemplates();
        this._ankiFieldTemplatesDefault = templates;
        return templates;
    }

    async _getDictionaryEntryDetails(dictionaryEntries) {
        const forceCanAddValue = (this._checkForDuplicates ? null : true);
        const fetchAdditionalInfo = (this._displayTags !== 'never');

        const notePromises = [];
        const noteTargets = [];
        for (let i = 0, ii = dictionaryEntries.length; i < ii; ++i) {
            const dictionaryEntry = dictionaryEntries[i];
            const {type} = dictionaryEntry;
            const modes = this._dictionaryEntryTypeModeMap.get(type);
            if (typeof modes === 'undefined') { continue; }
            for (const mode of modes) {
                const notePromise = this._createNote(dictionaryEntry, mode, []);
                notePromises.push(notePromise);
                noteTargets.push({index: i, mode});
            }
        }

        const noteInfoList = await Promise.all(notePromises);
        const notes = noteInfoList.map(({note}) => note);

        let infos;
        let ankiError = null;
        try {
            if (forceCanAddValue !== null) {
                if (!await yomichan.api.isAnkiConnected()) {
                    throw new Error('Anki not connected');
                }
                infos = this._getAnkiNoteInfoForceValue(notes, forceCanAddValue);
            } else {
                infos = await yomichan.api.getAnkiNoteInfo(notes, fetchAdditionalInfo);
            }
        } catch (e) {
            infos = this._getAnkiNoteInfoForceValue(notes, false);
            ankiError = e;
        }

        const results = [];
        for (let i = 0, ii = dictionaryEntries.length; i < ii; ++i) {
            results.push({
                modeMap: new Map()
            });
        }

        for (let i = 0, ii = noteInfoList.length; i < ii; ++i) {
            const {note, errors, requirements} = noteInfoList[i];
            const {canAdd, valid, noteIds, noteInfos} = infos[i];
            const {mode, index} = noteTargets[i];
            results[index].modeMap.set(mode, {mode, note, errors, requirements, canAdd, valid, noteIds, noteInfos, ankiError});
        }
        return results;
    }

    _getAnkiNoteInfoForceValue(notes, canAdd) {
        const results = [];
        for (const note of notes) {
            const valid = AnkiUtil.isNoteDataValid(note);
            results.push({canAdd, valid, noteIds: null});
        }
        return results;
    }

    async _createNote(dictionaryEntry, mode, requirements) {
        const context = this._noteContext;
        const modeOptions = this._modeOptions.get(mode);
        if (typeof modeOptions === 'undefined') { throw new Error(`Unsupported note type: ${mode}`); }
        const template = this._ankiFieldTemplates;
        const {deck: deckName, model: modelName} = modeOptions;
        const fields = Object.entries(modeOptions.fields);
        const contentOrigin = this._display.getContentOrigin();
        const details = this._ankiNoteBuilder.getDictionaryEntryDetailsForNote(dictionaryEntry);
        const audioDetails = this._getAnkiNoteMediaAudioDetails(details);
        const optionsContext = this._display.getOptionsContext();

        const {note, errors, requirements: outputRequirements} = await this._ankiNoteBuilder.createNote({
            dictionaryEntry,
            mode,
            context,
            template,
            deckName,
            modelName,
            fields,
            tags: this._noteTags,
            checkForDuplicates: this._checkForDuplicates,
            duplicateScope: this._duplicateScope,
            duplicateScopeCheckAllModels: this._duplicateScopeCheckAllModels,
            resultOutputMode: this._resultOutputMode,
            glossaryLayoutMode: this._glossaryLayoutMode,
            compactTags: this._compactTags,
            mediaOptions: {
                audio: audioDetails,
                screenshot: {
                    format: this._screenshotFormat,
                    quality: this._screenshotQuality,
                    contentOrigin
                },
                textParsing: {
                    optionsContext,
                    scanLength: this._scanLength
                }
            },
            requirements
        });

        // Custom edits =================
        // Remove "Clipboard monitor " text from a field where it's found.
        // It appears in the cloze prefix if you add a word that is at the
        // beginning of the sentence in Yomichan search

        for (const [field, value] of Object.entries(note.fields)) {
            if (value.includes('Clipboard monitor ')) {
                note.fields[field] = note.fields[field].replace('Clipboard monitor ', '').trim();
            }
        }

        // requires a field named "Sentence"
        // it looks like this: "{cloze-prefix} <strong>{cloze-body}</strong> {cloze-suffix}"
        if (note.fields["Sentence"]) {
            // remove cases where there's a space after punctuation marks
            // this happens if you set up the cloze prefix, cloze body, and
            // cloze suffix to be separated by spaces

            note.fields["Sentence"] = note.fields["Sentence"].replace(/\s(?=\p{P})/gu, '');
        }

        // ==============================

        return {note, errors, requirements: outputRequirements};
    }

    _getModes(isTerms) {
        return isTerms ? ['term-kanji', 'term-kana'] : ['kanji'];
    }

    _getValidSentenceData(sentence, fallback, fallbackOffset) {
        let {text, offset} = (isObject(sentence) ? sentence : {});
        if (typeof text !== 'string') {
            text = fallback;
            offset = fallbackOffset;
        } else {
            if (typeof offset !== 'number') { offset = 0; }
        }
        return {text, offset};
    }

    _getAnkiNoteMediaAudioDetails(details) {
        if (details.type !== 'term') { return null; }
        const {sources, preferredAudioIndex} = this._displayAudio.getAnkiNoteMediaAudioDetails(details.term, details.reading);
        return {sources, preferredAudioIndex, idleTimeout: this._audioDownloadIdleTimeout};
    }

    // View note functions

    _onViewNoteButtonClick(e) {
        e.preventDefault();
        if (e.shiftKey) {
            this._showViewNoteMenu(e.currentTarget);
        } else {
            this._viewNote(e.currentTarget);
        }
    }

    _onViewNoteButtonContextMenu(e) {
        e.preventDefault();
        this._showViewNoteMenu(e.currentTarget);
    }

    _onViewNoteButtonMenuClose(e) {
        const {detail: {action, item}} = e;
        switch (action) {
            case 'viewNote':
                this._viewNote(item);
                break;
        }
    }

    _updateViewNoteButton(index, noteIds, prepend) {
        const button = this._getViewNoteButton(index);
        if (button === null) { return; }
        if (prepend) {
            const currentNoteIds = button.dataset.noteIds;
            if (typeof currentNoteIds === 'string' && currentNoteIds.length > 0) {
                noteIds = [...noteIds, currentNoteIds.split(' ')];
            }
        }
        const disabled = (noteIds.length === 0);
        button.disabled = disabled;
        button.hidden = disabled;
        button.dataset.noteIds = noteIds.join(' ');

        const badge = button.querySelector('.action-button-badge');
        if (badge !== null) {
            const badgeData = badge.dataset;
            if (noteIds.length > 1) {
                badgeData.icon = 'plus-thick';
                badgeData.hidden = false;
            } else {
                delete badgeData.icon;
                badgeData.hidden = true;
            }
        }
    }

    async _viewNote(node) {
        const noteIds = this._getNodeNoteIds(node);
        if (noteIds.length === 0) { return; }
        try {
            await yomichan.api.noteView(noteIds[0], this._noteGuiMode, false);
        } catch (e) {
            const displayErrors = (
                e.message === 'Mode not supported' ?
                [this._display.displayGenerator.instantiateTemplateFragment('footer-notification-anki-view-note-error')] :
                void 0
            );
            this._showErrorNotification([e], displayErrors);
            return;
        }
    }

    _showViewNoteMenu(node) {
        const noteIds = this._getNodeNoteIds(node);
        if (noteIds.length === 0) { return; }

        const menuContainerNode = this._display.displayGenerator.instantiateTemplate('view-note-button-popup-menu');
        const menuBodyNode = menuContainerNode.querySelector('.popup-menu-body');

        for (let i = 0, ii = noteIds.length; i < ii; ++i) {
            const noteId = noteIds[i];
            const item = this._display.displayGenerator.instantiateTemplate('view-note-button-popup-menu-item');
            item.querySelector('.popup-menu-item-label').textContent = `Note ${i + 1}: ${noteId}`;
            item.dataset.menuAction = 'viewNote';
            item.dataset.noteIds = `${noteId}`;
            menuBodyNode.appendChild(item);
        }

        this._menuContainer.appendChild(menuContainerNode);
        const popupMenu = new PopupMenu(node, menuContainerNode);
        popupMenu.prepare();
    }

    _getNodeNoteIds(node) {
        const {noteIds} = node.dataset;
        const results = [];
        if (typeof noteIds === 'string' && noteIds.length > 0) {
            for (const noteId of noteIds.split(' ')) {
                const noteIdInt = Number.parseInt(noteId, 10);
                if (Number.isFinite(noteIdInt)) {
                    results.push(noteIdInt);
                }
            }
        }
        return results;
    }

    _getViewNoteButton(index) {
        const entry = this._getEntry(index);
        return entry !== null ? entry.querySelector('.action-button[data-action=view-note]') : null;
    }

    _viewNoteForSelectedEntry() {
        const index = this._display.selectedIndex;
        const button = this._getViewNoteButton(index);
        if (button !== null) {
            this._viewNote(button);
        }
    }
}
