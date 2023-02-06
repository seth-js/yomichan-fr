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
 * AccessibilityController
 * AnkiConnect
 * AnkiUtil
 * ArrayBufferUtil
 * AudioDownloader
 * ClipboardMonitor
 * ClipboardReader
 * DictionaryDatabase
 * Environment
 * JapaneseUtil
 * Mecab
 * MediaUtil
 * ObjectPropertyAccessor
 * OptionsUtil
 * PermissionsUtil
 * ProfileConditionsUtil
 * RequestBuilder
 * ScriptManager
 * Translator
 * wanakana
 */

class Backend {
    constructor() {
        this._japaneseUtil = new JapaneseUtil(wanakana);
        this._environment = new Environment();
        this._dictionaryDatabase = new DictionaryDatabase();
        this._translator = new Translator({
            japaneseUtil: this._japaneseUtil,
            database: this._dictionaryDatabase
        });
        this._anki = new AnkiConnect();
        this._mecab = new Mecab();
        this._clipboardReader = new ClipboardReader({
            // eslint-disable-next-line no-undef
            document: (typeof document === 'object' && document !== null ? document : null),
            pasteTargetSelector: '#clipboard-paste-target',
            imagePasteTargetSelector: '#clipboard-image-paste-target'
        });
        this._clipboardMonitor = new ClipboardMonitor({
            japaneseUtil: this._japaneseUtil,
            clipboardReader: this._clipboardReader
        });
        this._options = null;
        this._profileConditionsSchemaCache = [];
        this._profileConditionsUtil = new ProfileConditionsUtil();
        this._defaultAnkiFieldTemplates = null;
        this._requestBuilder = new RequestBuilder();
        this._audioDownloader = new AudioDownloader({
            japaneseUtil: this._japaneseUtil,
            requestBuilder: this._requestBuilder
        });
        this._optionsUtil = new OptionsUtil();
        this._scriptManager = new ScriptManager();
        this._accessibilityController = new AccessibilityController(this._scriptManager);

        this._searchPopupTabId = null;
        this._searchPopupTabCreatePromise = null;

        this._isPrepared = false;
        this._prepareError = false;
        this._preparePromise = null;
        const {promise, resolve, reject} = deferPromise();
        this._prepareCompletePromise = promise;
        this._prepareCompleteResolve = resolve;
        this._prepareCompleteReject = reject;

        this._defaultBrowserActionTitle = null;
        this._badgePrepareDelayTimer = null;
        this._logErrorLevel = null;
        this._permissions = null;
        this._permissionsUtil = new PermissionsUtil();

        this._messageHandlers = new Map([
            ['requestBackendReadySignal',    {async: false, contentScript: true,  handler: this._onApiRequestBackendReadySignal.bind(this)}],
            ['optionsGet',                   {async: false, contentScript: true,  handler: this._onApiOptionsGet.bind(this)}],
            ['optionsGetFull',               {async: false, contentScript: true,  handler: this._onApiOptionsGetFull.bind(this)}],
            ['kanjiFind',                    {async: true,  contentScript: true,  handler: this._onApiKanjiFind.bind(this)}],
            ['termsFind',                    {async: true,  contentScript: true,  handler: this._onApiTermsFind.bind(this)}],
            ['parseText',                    {async: true,  contentScript: true,  handler: this._onApiParseText.bind(this)}],
            ['getAnkiConnectVersion',        {async: true,  contentScript: true,  handler: this._onApGetAnkiConnectVersion.bind(this)}],
            ['isAnkiConnected',              {async: true,  contentScript: true,  handler: this._onApiIsAnkiConnected.bind(this)}],
            ['addAnkiNote',                  {async: true,  contentScript: true,  handler: this._onApiAddAnkiNote.bind(this)}],
            ['getAnkiNoteInfo',              {async: true,  contentScript: true,  handler: this._onApiGetAnkiNoteInfo.bind(this)}],
            ['injectAnkiNoteMedia',          {async: true,  contentScript: true,  handler: this._onApiInjectAnkiNoteMedia.bind(this)}],
            ['noteView',                     {async: true,  contentScript: true,  handler: this._onApiNoteView.bind(this)}],
            ['suspendAnkiCardsForNote',      {async: true,  contentScript: true,  handler: this._onApiSuspendAnkiCardsForNote.bind(this)}],
            ['commandExec',                  {async: false, contentScript: true,  handler: this._onApiCommandExec.bind(this)}],
            ['getTermAudioInfoList',         {async: true,  contentScript: true,  handler: this._onApiGetTermAudioInfoList.bind(this)}],
            ['sendMessageToFrame',           {async: false, contentScript: true,  handler: this._onApiSendMessageToFrame.bind(this)}],
            ['broadcastTab',                 {async: false, contentScript: true,  handler: this._onApiBroadcastTab.bind(this)}],
            ['frameInformationGet',          {async: true,  contentScript: true,  handler: this._onApiFrameInformationGet.bind(this)}],
            ['injectStylesheet',             {async: true,  contentScript: true,  handler: this._onApiInjectStylesheet.bind(this)}],
            ['getStylesheetContent',         {async: true,  contentScript: true,  handler: this._onApiGetStylesheetContent.bind(this)}],
            ['getEnvironmentInfo',           {async: false, contentScript: true,  handler: this._onApiGetEnvironmentInfo.bind(this)}],
            ['clipboardGet',                 {async: true,  contentScript: true,  handler: this._onApiClipboardGet.bind(this)}],
            ['getDisplayTemplatesHtml',      {async: true,  contentScript: true,  handler: this._onApiGetDisplayTemplatesHtml.bind(this)}],
            ['getZoom',                      {async: true,  contentScript: true,  handler: this._onApiGetZoom.bind(this)}],
            ['getDefaultAnkiFieldTemplates', {async: false, contentScript: true,  handler: this._onApiGetDefaultAnkiFieldTemplates.bind(this)}],
            ['getDictionaryInfo',            {async: true,  contentScript: true,  handler: this._onApiGetDictionaryInfo.bind(this)}],
            ['purgeDatabase',                {async: true,  contentScript: false, handler: this._onApiPurgeDatabase.bind(this)}],
            ['getMedia',                     {async: true,  contentScript: true,  handler: this._onApiGetMedia.bind(this)}],
            ['log',                          {async: false, contentScript: true,  handler: this._onApiLog.bind(this)}],
            ['logIndicatorClear',            {async: false, contentScript: true,  handler: this._onApiLogIndicatorClear.bind(this)}],
            ['createActionPort',             {async: false, contentScript: true,  handler: this._onApiCreateActionPort.bind(this)}],
            ['modifySettings',               {async: true,  contentScript: true,  handler: this._onApiModifySettings.bind(this)}],
            ['getSettings',                  {async: false, contentScript: true,  handler: this._onApiGetSettings.bind(this)}],
            ['setAllSettings',               {async: true,  contentScript: false, handler: this._onApiSetAllSettings.bind(this)}],
            ['getOrCreateSearchPopup',       {async: true,  contentScript: true,  handler: this._onApiGetOrCreateSearchPopup.bind(this)}],
            ['isTabSearchPopup',             {async: true,  contentScript: true,  handler: this._onApiIsTabSearchPopup.bind(this)}],
            ['triggerDatabaseUpdated',       {async: false, contentScript: true,  handler: this._onApiTriggerDatabaseUpdated.bind(this)}],
            ['testMecab',                    {async: true,  contentScript: true,  handler: this._onApiTestMecab.bind(this)}],
            ['textHasJapaneseCharacters',    {async: false, contentScript: true,  handler: this._onApiTextHasJapaneseCharacters.bind(this)}],
            ['getTermFrequencies',           {async: true,  contentScript: true,  handler: this._onApiGetTermFrequencies.bind(this)}],
            ['findAnkiNotes',                {async: true,  contentScript: true,  handler: this._onApiFindAnkiNotes.bind(this)}],
            ['loadExtensionScripts',         {async: true,  contentScript: true,  handler: this._onApiLoadExtensionScripts.bind(this)}]
        ]);
        this._messageHandlersWithProgress = new Map([
        ]);

        this._commandHandlers = new Map([
            ['toggleTextScanning', this._onCommandToggleTextScanning.bind(this)],
            ['openInfoPage',       this._onCommandOpenInfoPage.bind(this)],
            ['openSettingsPage',   this._onCommandOpenSettingsPage.bind(this)],
            ['openSearchPage',     this._onCommandOpenSearchPage.bind(this)],
            ['openPopupWindow',    this._onCommandOpenPopupWindow.bind(this)]
        ]);
    }

    prepare() {
        if (this._preparePromise === null) {
            const promise = this._prepareInternal();
            promise.then(
                (value) => {
                    this._isPrepared = true;
                    this._prepareCompleteResolve(value);
                },
                (error) => {
                    this._prepareError = true;
                    this._prepareCompleteReject(error);
                }
            );
            promise.finally(() => this._updateBadge());
            this._preparePromise = promise;
        }
        return this._prepareCompletePromise;
    }

    // Private

    _prepareInternalSync() {
        if (isObject(chrome.commands) && isObject(chrome.commands.onCommand)) {
            const onCommand = this._onWebExtensionEventWrapper(this._onCommand.bind(this));
            chrome.commands.onCommand.addListener(onCommand);
        }

        if (isObject(chrome.tabs) && isObject(chrome.tabs.onZoomChange)) {
            const onZoomChange = this._onWebExtensionEventWrapper(this._onZoomChange.bind(this));
            chrome.tabs.onZoomChange.addListener(onZoomChange);
        }

        const onConnect = this._onWebExtensionEventWrapper(this._onConnect.bind(this));
        chrome.runtime.onConnect.addListener(onConnect);

        const onMessage = this._onMessageWrapper.bind(this);
        chrome.runtime.onMessage.addListener(onMessage);

        if (this._canObservePermissionsChanges()) {
            const onPermissionsChanged = this._onWebExtensionEventWrapper(this._onPermissionsChanged.bind(this));
            chrome.permissions.onAdded.addListener(onPermissionsChanged);
            chrome.permissions.onRemoved.addListener(onPermissionsChanged);
        }

        chrome.runtime.onInstalled.addListener(this._onInstalled.bind(this));
    }

    async _prepareInternal() {
        try {
            this._prepareInternalSync();

            this._permissions = await this._permissionsUtil.getAllPermissions();
            this._defaultBrowserActionTitle = await this._getBrowserIconTitle();
            this._badgePrepareDelayTimer = setTimeout(() => {
                this._badgePrepareDelayTimer = null;
                this._updateBadge();
            }, 1000);
            this._updateBadge();

            yomichan.on('log', this._onLog.bind(this));

            await this._requestBuilder.prepare();
            await this._environment.prepare();
            this._clipboardReader.browser = this._environment.getInfo().browser;

            try {
                await this._dictionaryDatabase.prepare();
            } catch (e) {
                log.error(e);
            }

            const deinflectionReasions = await this._fetchAsset('/data/deinflect.json', true);
            this._translator.prepare(deinflectionReasions);

            await this._optionsUtil.prepare();
            this._defaultAnkiFieldTemplates = (await this._fetchAsset('/data/templates/default-anki-field-templates.handlebars')).trim();
            this._options = await this._optionsUtil.load();

            this._applyOptions('background');

            const options = this._getProfileOptions({current: true});
            if (options.general.showGuide) {
                this._openWelcomeGuidePage();
            }

            this._clipboardMonitor.on('change', this._onClipboardTextChange.bind(this));

            this._sendMessageAllTabsIgnoreResponse('Yomichan.backendReady', {});
            this._sendMessageIgnoreResponse({action: 'Yomichan.backendReady', params: {}});
        } catch (e) {
            log.error(e);
            throw e;
        } finally {
            if (this._badgePrepareDelayTimer !== null) {
                clearTimeout(this._badgePrepareDelayTimer);
                this._badgePrepareDelayTimer = null;
            }
        }
    }

    // Event handlers

    async _onClipboardTextChange({text}) {
        const {clipboard: {maximumSearchLength}} = this._getProfileOptions({current: true});
        if (text.length > maximumSearchLength) {
            text = text.substring(0, maximumSearchLength);
        }
        try {
            const {tab, created} = await this._getOrCreateSearchPopup();
            await this._focusTab(tab);
            await this._updateSearchQuery(tab.id, text, !created);
        } catch (e) {
            // NOP
        }
    }

    _onLog({level}) {
        const levelValue = this._getErrorLevelValue(level);
        if (levelValue <= this._getErrorLevelValue(this._logErrorLevel)) { return; }

        this._logErrorLevel = level;
        this._updateBadge();
    }

    // WebExtension event handlers (with prepared checks)

    _onWebExtensionEventWrapper(handler) {
        return (...args) => {
            if (this._isPrepared) {
                handler(...args);
                return;
            }

            this._prepareCompletePromise.then(
                () => { handler(...args); },
                () => {} // NOP
            );
        };
    }

    _onMessageWrapper(message, sender, sendResponse) {
        if (this._isPrepared) {
            return this._onMessage(message, sender, sendResponse);
        }

        this._prepareCompletePromise.then(
            () => { this._onMessage(message, sender, sendResponse); },
            () => { sendResponse(); }
        );
        return true;
    }

    // WebExtension event handlers

    _onCommand(command) {
        this._runCommand(command);
    }

    _onMessage({action, params}, sender, callback) {
        const messageHandler = this._messageHandlers.get(action);
        if (typeof messageHandler === 'undefined') { return false; }

        if (!messageHandler.contentScript) {
            try {
                this._validatePrivilegedMessageSender(sender);
            } catch (error) {
                callback({error: serializeError(error)});
                return false;
            }
        }

        return invokeMessageHandler(messageHandler, params, callback, sender);
    }

    _onConnect(port) {
        try {
            let details;
            try {
                details = JSON.parse(port.name);
            } catch (e) {
                return;
            }
            if (details.name !== 'background-cross-frame-communication-port') { return; }

            const senderTabId = (port.sender && port.sender.tab ? port.sender.tab.id : null);
            if (typeof senderTabId !== 'number') {
                throw new Error('Port does not have an associated tab ID');
            }
            const senderFrameId = port.sender.frameId;
            if (typeof senderFrameId !== 'number') {
                throw new Error('Port does not have an associated frame ID');
            }
            let {targetTabId, targetFrameId} = details;
            if (typeof targetTabId !== 'number') {
                targetTabId = senderTabId;
            }

            const details2 = {
                name: 'cross-frame-communication-port',
                sourceTabId: senderTabId,
                sourceFrameId: senderFrameId
            };
            let forwardPort = chrome.tabs.connect(targetTabId, {frameId: targetFrameId, name: JSON.stringify(details2)});

            const cleanup = () => {
                this._checkLastError(chrome.runtime.lastError);
                if (forwardPort !== null) {
                    forwardPort.disconnect();
                    forwardPort = null;
                }
                if (port !== null) {
                    port.disconnect();
                    port = null;
                }
            };

            port.onMessage.addListener((message) => { forwardPort.postMessage(message); });
            forwardPort.onMessage.addListener((message) => { port.postMessage(message); });
            port.onDisconnect.addListener(cleanup);
            forwardPort.onDisconnect.addListener(cleanup);
        } catch (e) {
            port.disconnect();
            log.error(e);
        }
    }

    _onZoomChange({tabId, oldZoomFactor, newZoomFactor}) {
        this._sendMessageTabIgnoreResponse(tabId, {action: 'Yomichan.zoomChanged', params: {oldZoomFactor, newZoomFactor}});
    }

    _onPermissionsChanged() {
        this._checkPermissions();
    }

    _onInstalled({reason}) {
        if (reason !== 'install') { return; }
        this._requestPersistentStorage();
    }

    // Message handlers

    _onApiRequestBackendReadySignal(_params, sender) {
        // tab ID isn't set in background (e.g. browser_action)
        const data = {action: 'Yomichan.backendReady', params: {}};
        if (typeof sender.tab === 'undefined') {
            this._sendMessageIgnoreResponse(data);
            return false;
        } else {
            this._sendMessageTabIgnoreResponse(sender.tab.id, data);
            return true;
        }
    }

    _onApiOptionsGet({optionsContext}) {
        return this._getProfileOptions(optionsContext);
    }

    _onApiOptionsGetFull() {
        return this._getOptionsFull();
    }

    async _onApiKanjiFind({text, optionsContext}) {
        const options = this._getProfileOptions(optionsContext);
        const {general: {maxResults}} = options;
        const findKanjiOptions = this._getTranslatorFindKanjiOptions(options);
        const dictionaryEntries = await this._translator.findKanji(text, findKanjiOptions);
        dictionaryEntries.splice(maxResults);
        return dictionaryEntries;
    }

    async _onApiTermsFind({text, details, optionsContext}) {
        const options = this._getProfileOptions(optionsContext);
        const {general: {resultOutputMode: mode, maxResults}} = options;
        const findTermsOptions = this._getTranslatorFindTermsOptions(mode, details, options);
        const {dictionaryEntries, originalTextLength} = await this._translator.findTerms(mode, text, findTermsOptions);
        dictionaryEntries.splice(maxResults);
        return {dictionaryEntries, originalTextLength};
    }

    async _onApiParseText({text, optionsContext, scanLength, useInternalParser, useMecabParser}) {
        const [internalResults, mecabResults] = await Promise.all([
            (useInternalParser ? this._textParseScanning(text, scanLength, optionsContext) : null),
            (useMecabParser ? this._textParseMecab(text) : null)
        ]);

        const results = [];

        if (internalResults !== null) {
            results.push({
                id: 'scan',
                source: 'scanning-parser',
                dictionary: null,
                content: internalResults
            });
        }

        if (mecabResults !== null) {
            for (const [dictionary, content] of mecabResults) {
                results.push({
                    id: `mecab-${dictionary}`,
                    source: 'mecab',
                    dictionary,
                    content
                });
            }
        }

        return results;
    }

    async _onApGetAnkiConnectVersion() {
        return await this._anki.getVersion();
    }

    async _onApiIsAnkiConnected() {
        return await this._anki.isConnected();
    }

    async _onApiAddAnkiNote({note}) {
        return await this._anki.addNote(note);
    }

    async _onApiGetAnkiNoteInfo({notes, fetchAdditionalInfo}) {
        const results = [];
        const cannotAdd = [];
        const canAddArray = await this._anki.canAddNotes(notes);

        for (let i = 0; i < notes.length; ++i) {
            const note = notes[i];
            let canAdd = canAddArray[i];
            const valid = AnkiUtil.isNoteDataValid(note);
            if (!valid) { canAdd = false; }
            const info = {canAdd, valid, noteIds: null};
            results.push(info);
            if (!canAdd && valid) {
                cannotAdd.push({note, info});
            }
        }

        if (cannotAdd.length > 0) {
            const cannotAddNotes = cannotAdd.map(({note}) => note);
            const noteIdsArray = await this._anki.findNoteIds(cannotAddNotes);
            for (let i = 0, ii = Math.min(cannotAdd.length, noteIdsArray.length); i < ii; ++i) {
                const noteIds = noteIdsArray[i];
                if (noteIds.length > 0) {
                    cannotAdd[i].info.noteIds = noteIds;
                    if (fetchAdditionalInfo) {
                        cannotAdd[i].info.noteInfos = await this._anki.notesInfo(noteIds);
                    }
                }
            }
        }

        return results;
    }

    async _onApiInjectAnkiNoteMedia({timestamp, definitionDetails, audioDetails, screenshotDetails, clipboardDetails, dictionaryMediaDetails}) {
        return await this._injectAnkNoteMedia(
            this._anki,
            timestamp,
            definitionDetails,
            audioDetails,
            screenshotDetails,
            clipboardDetails,
            dictionaryMediaDetails
        );
    }

    async _onApiNoteView({noteId, mode, allowFallback}) {
        if (mode === 'edit') {
            try {
                await this._anki.guiEditNote(noteId);
                return 'edit';
            } catch (e) {
                if (!this._anki.isErrorUnsupportedAction(e)) {
                    throw e;
                } else if (!allowFallback) {
                    throw new Error('Mode not supported');
                }
            }
        }
        // Fallback
        await this._anki.guiBrowseNote(noteId);
        return 'browse';
    }

    async _onApiSuspendAnkiCardsForNote({noteId}) {
        const cardIds = await this._anki.findCardsForNote(noteId);
        const count = cardIds.length;
        if (count > 0) {
            const okay = await this._anki.suspendCards(cardIds);
            if (!okay) { return 0; }
        }
        return count;
    }

    _onApiCommandExec({command, params}) {
        return this._runCommand(command, params);
    }

    async _onApiGetTermAudioInfoList({source, term, reading}) {
        return await this._audioDownloader.getTermAudioInfoList(source, term, reading);
    }

    _onApiSendMessageToFrame({frameId: targetFrameId, action, params}, sender) {
        if (!(sender && sender.tab)) {
            return false;
        }

        const tabId = sender.tab.id;
        const frameId = sender.frameId;
        this._sendMessageTabIgnoreResponse(tabId, {action, params, frameId}, {frameId: targetFrameId});
        return true;
    }

    _onApiBroadcastTab({action, params}, sender) {
        if (!(sender && sender.tab)) {
            return false;
        }

        const tabId = sender.tab.id;
        const frameId = sender.frameId;
        this._sendMessageTabIgnoreResponse(tabId, {action, params, frameId});
        return true;
    }

    _onApiFrameInformationGet(params, sender) {
        const tab = sender.tab;
        const tabId = tab ? tab.id : void 0;
        const frameId = sender.frameId;
        return Promise.resolve({tabId, frameId});
    }

    async _onApiInjectStylesheet({type, value}, sender) {
        const {frameId, tab} = sender;
        if (!isObject(tab)) { throw new Error('Invalid tab'); }
        return await this._scriptManager.injectStylesheet(type, value, tab.id, frameId, false, true, 'document_start');
    }

    async _onApiGetStylesheetContent({url}) {
        if (!url.startsWith('/') || url.startsWith('//') || !url.endsWith('.css')) {
            throw new Error('Invalid URL');
        }
        return await this._fetchAsset(url);
    }

    _onApiGetEnvironmentInfo() {
        return this._environment.getInfo();
    }

    async _onApiClipboardGet() {
        return this._clipboardReader.getText();
    }

    async _onApiGetDisplayTemplatesHtml() {
        return await this._fetchAsset('/display-templates.html');
    }

    _onApiGetZoom(params, sender) {
        if (!sender || !sender.tab) {
            return Promise.reject(new Error('Invalid tab'));
        }

        return new Promise((resolve, reject) => {
            const tabId = sender.tab.id;
            if (!(
                chrome.tabs !== null &&
                typeof chrome.tabs === 'object' &&
                typeof chrome.tabs.getZoom === 'function'
            )) {
                // Not supported
                resolve({zoomFactor: 1.0});
                return;
            }
            chrome.tabs.getZoom(tabId, (zoomFactor) => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve({zoomFactor});
                }
            });
        });
    }

    _onApiGetDefaultAnkiFieldTemplates() {
        return this._defaultAnkiFieldTemplates;
    }

    async _onApiGetDictionaryInfo() {
        return await this._dictionaryDatabase.getDictionaryInfo();
    }

    async _onApiPurgeDatabase() {
        await this._dictionaryDatabase.purge();
        this._triggerDatabaseUpdated('dictionary', 'purge');
    }

    async _onApiGetMedia({targets}) {
        return await this._getNormalizedDictionaryDatabaseMedia(targets);
    }

    _onApiLog({error, level, context}) {
        log.log(deserializeError(error), level, context);
    }

    _onApiLogIndicatorClear() {
        if (this._logErrorLevel === null) { return; }
        this._logErrorLevel = null;
        this._updateBadge();
    }

    _onApiCreateActionPort(params, sender) {
        if (!sender || !sender.tab) { throw new Error('Invalid sender'); }
        const tabId = sender.tab.id;
        if (typeof tabId !== 'number') { throw new Error('Sender has invalid tab ID'); }

        const frameId = sender.frameId;
        const id = generateId(16);
        const details = {
            name: 'action-port',
            id
        };

        const port = chrome.tabs.connect(tabId, {name: JSON.stringify(details), frameId});
        try {
            this._createActionListenerPort(port, sender, this._messageHandlersWithProgress);
        } catch (e) {
            port.disconnect();
            throw e;
        }

        return details;
    }

    _onApiModifySettings({targets, source}) {
        return this._modifySettings(targets, source);
    }

    _onApiGetSettings({targets}) {
        const results = [];
        for (const target of targets) {
            try {
                const result = this._getSetting(target);
                results.push({result: clone(result)});
            } catch (e) {
                results.push({error: serializeError(e)});
            }
        }
        return results;
    }

    async _onApiSetAllSettings({value, source}) {
        this._optionsUtil.validate(value);
        this._options = clone(value);
        await this._saveOptions(source);
    }

    async _onApiGetOrCreateSearchPopup({focus=false, text=null}) {
        const {tab, created} = await this._getOrCreateSearchPopup();
        if (focus === true || (focus === 'ifCreated' && created)) {
            await this._focusTab(tab);
        }
        if (typeof text === 'string') {
            await this._updateSearchQuery(tab.id, text, !created);
        }
        return {tabId: tab.id, windowId: tab.windowId};
    }

    async _onApiIsTabSearchPopup({tabId}) {
        const baseUrl = chrome.runtime.getURL('/search.html');
        const tab = typeof tabId === 'number' ? await this._checkTabUrl(tabId, (url) => url.startsWith(baseUrl)) : null;
        return (tab !== null);
    }

    _onApiTriggerDatabaseUpdated({type, cause}) {
        this._triggerDatabaseUpdated(type, cause);
    }

    async _onApiTestMecab() {
        if (!this._mecab.isEnabled()) {
            throw new Error('MeCab not enabled');
        }

        let permissionsOkay = false;
        try {
            permissionsOkay = await this._permissionsUtil.hasPermissions({permissions: ['nativeMessaging']});
        } catch (e) {
            // NOP
        }
        if (!permissionsOkay) {
            throw new Error('Insufficient permissions');
        }

        const disconnect = !this._mecab.isConnected();
        try {
            const version = await this._mecab.getVersion();
            if (version === null) {
                throw new Error('Could not connect to native MeCab component');
            }

            const localVersion = this._mecab.getLocalVersion();
            if (version !== localVersion) {
                throw new Error(`MeCab component version not supported: ${version}`);
            }
        } finally {
            // Disconnect if the connection was previously disconnected
            if (disconnect && this._mecab.isEnabled() && this._mecab.isActive()) {
                this._mecab.disconnect();
            }
        }

        return true;
    }

    _onApiTextHasJapaneseCharacters({text}) {
        return this._japaneseUtil.isStringPartiallyJapanese(text);
    }

    async _onApiGetTermFrequencies({termReadingList, dictionaries}) {
        return await this._translator.getTermFrequencies(termReadingList, dictionaries);
    }

    async _onApiFindAnkiNotes({query}) {
        return await this._anki.findNotes(query);
    }

    async _onApiLoadExtensionScripts({files}, sender) {
        if (!sender || !sender.tab) { throw new Error('Invalid sender'); }
        const tabId = sender.tab.id;
        if (typeof tabId !== 'number') { throw new Error('Sender has invalid tab ID'); }
        const {frameId} = sender;
        for (const file of files) {
            await this._scriptManager.injectScript(file, tabId, frameId, false, true, 'document_start');
        }
    }

    // Command handlers

    async _onCommandOpenSearchPage(params) {
        const {mode='existingOrNewTab', query} = params || {};

        const baseUrl = chrome.runtime.getURL('/search.html');
        const queryParams = {};
        if (query && query.length > 0) { queryParams.query = query; }
        const queryString = new URLSearchParams(queryParams).toString();
        let url = baseUrl;
        if (queryString.length > 0) {
            url += `?${queryString}`;
        }

        const predicate = ({url: url2}) => {
            if (url2 === null || !url2.startsWith(baseUrl)) { return false; }
            const parsedUrl = new URL(url2);
            const baseUrl2 = `${parsedUrl.origin}${parsedUrl.pathname}`;
            const mode2 = parsedUrl.searchParams.get('mode');
            return baseUrl2 === baseUrl && (mode2 === mode || (!mode2 && mode === 'existingOrNewTab'));
        };

        const openInTab = async () => {
            const tabInfo = await this._findTabs(1000, false, predicate, false);
            if (tabInfo !== null) {
                const {tab} = tabInfo;
                await this._focusTab(tab);
                if (queryParams.query) {
                    await this._updateSearchQuery(tab.id, queryParams.query, true);
                }
                return true;
            }
        };

        switch (mode) {
            case 'existingOrNewTab':
                try {
                    if (await openInTab()) { return; }
                } catch (e) {
                    // NOP
                }
                await this._createTab(url);
                return;
            case 'newTab':
                await this._createTab(url);
                return;
        }
    }

    async _onCommandOpenInfoPage() {
        await this._openInfoPage();
    }

    async _onCommandOpenSettingsPage(params) {
        const {mode='existingOrNewTab'} = params || {};
        await this._openSettingsPage(mode);
    }

    async _onCommandToggleTextScanning() {
        const options = this._getProfileOptions({current: true});
        await this._modifySettings([{
            action: 'set',
            path: 'general.enable',
            value: !options.general.enable,
            scope: 'profile',
            optionsContext: {current: true}
        }], 'backend');
    }

    async _onCommandOpenPopupWindow() {
        await this._onApiGetOrCreateSearchPopup({focus: true});
    }

    // Utilities

    async _modifySettings(targets, source) {
        const results = [];
        for (const target of targets) {
            try {
                const result = this._modifySetting(target);
                results.push({result: clone(result)});
            } catch (e) {
                results.push({error: serializeError(e)});
            }
        }
        await this._saveOptions(source);
        return results;
    }

    _getOrCreateSearchPopup() {
        if (this._searchPopupTabCreatePromise === null) {
            const promise = this._getOrCreateSearchPopup2();
            this._searchPopupTabCreatePromise = promise;
            promise.then(() => { this._searchPopupTabCreatePromise = null; });
        }
        return this._searchPopupTabCreatePromise;
    }

    async _getOrCreateSearchPopup2() {
        // Use existing tab
        const baseUrl = chrome.runtime.getURL('/search.html');
        const urlPredicate = (url) => url !== null && url.startsWith(baseUrl);
        if (this._searchPopupTabId !== null) {
            const tab = await this._checkTabUrl(this._searchPopupTabId, urlPredicate);
            if (tab !== null) {
                return {tab, created: false};
            }
            this._searchPopupTabId = null;
        }

        // Find existing tab
        const existingTabInfo = await this._findSearchPopupTab(urlPredicate);
        if (existingTabInfo !== null) {
            const existingTab = existingTabInfo.tab;
            this._searchPopupTabId = existingTab.id;
            return {tab: existingTab, created: false};
        }

        // chrome.windows not supported (e.g. on Firefox mobile)
        if (!isObject(chrome.windows)) {
            throw new Error('Window creation not supported');
        }

        // Create a new window
        const options = this._getProfileOptions({current: true});
        const createData = this._getSearchPopupWindowCreateData(baseUrl, options);
        const {popupWindow: {windowState}} = options;
        const popupWindow = await this._createWindow(createData);
        if (windowState !== 'normal') {
            await this._updateWindow(popupWindow.id, {state: windowState});
        }

        const {tabs} = popupWindow;
        if (tabs.length === 0) {
            throw new Error('Created window did not contain a tab');
        }

        const tab = tabs[0];
        await this._waitUntilTabFrameIsReady(tab.id, 0, 2000);

        await this._sendMessageTabPromise(
            tab.id,
            {action: 'SearchDisplayController.setMode', params: {mode: 'popup'}},
            {frameId: 0}
        );

        this._searchPopupTabId = tab.id;
        return {tab, created: true};
    }

    async _findSearchPopupTab(urlPredicate) {
        const predicate = async ({url, tab}) => {
            if (!urlPredicate(url)) { return false; }
            try {
                const mode = await this._sendMessageTabPromise(
                    tab.id,
                    {action: 'SearchDisplayController.getMode', params: {}},
                    {frameId: 0}
                );
                return mode === 'popup';
            } catch (e) {
                return false;
            }
        };
        return await this._findTabs(1000, false, predicate, true);
    }

    _getSearchPopupWindowCreateData(url, options) {
        const {popupWindow: {width, height, left, top, useLeft, useTop, windowType}} = options;
        return {
            url,
            width,
            height,
            left: useLeft ? left : void 0,
            top: useTop ? top : void 0,
            type: windowType,
            state: 'normal'
        };
    }

    _createWindow(createData) {
        return new Promise((resolve, reject) => {
            chrome.windows.create(
                createData,
                (result) => {
                    const error = chrome.runtime.lastError;
                    if (error) {
                        reject(new Error(error.message));
                    } else {
                        resolve(result);
                    }
                }
            );
        });
    }

    _updateWindow(windowId, updateInfo) {
        return new Promise((resolve, reject) => {
            chrome.windows.update(
                windowId,
                updateInfo,
                (result) => {
                    const error = chrome.runtime.lastError;
                    if (error) {
                        reject(new Error(error.message));
                    } else {
                        resolve(result);
                    }
                }
            );
        });
    }

    _updateSearchQuery(tabId, text, animate) {
        return this._sendMessageTabPromise(
            tabId,
            {action: 'SearchDisplayController.updateSearchQuery', params: {text, animate}},
            {frameId: 0}
        );
    }

    _applyOptions(source) {
        const options = this._getProfileOptions({current: true});
        this._updateBadge();

        const enabled = options.general.enable;

        let {apiKey} = options.anki;
        if (apiKey === '') { apiKey = null; }
        this._anki.server = options.anki.server;
        this._anki.enabled = options.anki.enable && enabled;
        this._anki.apiKey = apiKey;

        this._mecab.setEnabled(options.parsing.enableMecabParser && enabled);

        if (options.clipboard.enableBackgroundMonitor && enabled) {
            this._clipboardMonitor.start();
        } else {
            this._clipboardMonitor.stop();
        }

        this._accessibilityController.update(this._getOptionsFull(false));

        this._sendMessageAllTabsIgnoreResponse('Yomichan.optionsUpdated', {source});
    }

    _getOptionsFull(useSchema=false) {
        const options = this._options;
        return useSchema ? this._optionsUtil.createValidatingProxy(options) : options;
    }

    _getProfileOptions(optionsContext, useSchema=false) {
        return this._getProfile(optionsContext, useSchema).options;
    }

    _getProfile(optionsContext, useSchema=false) {
        const options = this._getOptionsFull(useSchema);
        const profiles = options.profiles;
        if (!optionsContext.current) {
            // Specific index
            const {index} = optionsContext;
            if (typeof index === 'number') {
                if (index < 0 || index >= profiles.length) {
                    throw this._createDataError(`Invalid profile index: ${index}`, optionsContext);
                }
                return profiles[index];
            }
            // From context
            const profile = this._getProfileFromContext(options, optionsContext);
            if (profile !== null) {
                return profile;
            }
        }
        // Default
        const {profileCurrent} = options;
        if (profileCurrent < 0 || profileCurrent >= profiles.length) {
            throw this._createDataError(`Invalid current profile index: ${profileCurrent}`, optionsContext);
        }
        return profiles[profileCurrent];
    }

    _getProfileFromContext(options, optionsContext) {
        optionsContext = this._profileConditionsUtil.normalizeContext(optionsContext);

        let index = 0;
        for (const profile of options.profiles) {
            const conditionGroups = profile.conditionGroups;

            let schema;
            if (index < this._profileConditionsSchemaCache.length) {
                schema = this._profileConditionsSchemaCache[index];
            } else {
                schema = this._profileConditionsUtil.createSchema(conditionGroups);
                this._profileConditionsSchemaCache.push(schema);
            }

            if (conditionGroups.length > 0 && schema.isValid(optionsContext)) {
                return profile;
            }
            ++index;
        }

        return null;
    }

    _createDataError(message, data) {
        const error = new Error(message);
        error.data = data;
        return error;
    }

    _clearProfileConditionsSchemaCache() {
        this._profileConditionsSchemaCache = [];
    }

    _checkLastError() {
        // NOP
    }

    _runCommand(command, params) {
        const handler = this._commandHandlers.get(command);
        if (typeof handler !== 'function') { return false; }

        handler(params);
        return true;
    }

    async _textParseScanning(text, scanLength, optionsContext) {
        // Custom edits =================
        // Don't use Japanese text segmentation since it breaks things

        // const jp = this._japaneseUtil;
        // const mode = 'simple';
        // const options = this._getProfileOptions(optionsContext);
        // const details = {matchType: 'exact', deinflect: true};
        // const findTermsOptions = this._getTranslatorFindTermsOptions(mode, details, options);
        // const results = [];
        // let previousUngroupedSegment = null;
        // let i = 0;
        // const ii = text.length;
        // while (i < ii) {
        //     const {dictionaryEntries, originalTextLength} = await this._translator.findTerms(
        //         mode,
        //         text.substring(i, i + scanLength),
        //         findTermsOptions
        //     );
        //     const codePoint = text.codePointAt(i);
        //     const character = String.fromCodePoint(codePoint);
        //     if (
        //         dictionaryEntries.length > 0 &&
        //         originalTextLength > 0 &&
        //         (originalTextLength !== character.length || jp.isCodePointJapanese(codePoint))
        //     ) {
        //         previousUngroupedSegment = null;
        //         const {headwords: [{term, reading}]} = dictionaryEntries[0];
        //         const source = text.substring(i, i + originalTextLength);
        //         const textSegments = [];
        //         for (const {text: text2, reading: reading2} of jp.distributeFuriganaInflected(term, reading, source)) {
        //             textSegments.push({text: text2, reading: reading2});
        //         }
        //         results.push(textSegments);
        //         i += originalTextLength;
        //     } else {
        //         if (previousUngroupedSegment === null) {
        //             previousUngroupedSegment = {text: character, reading: ''};
        //             results.push([previousUngroupedSegment]);
        //         } else {
        //             previousUngroupedSegment.text += character;
        //         }
        //         i += character.length;
        //     }
        // }
        // return results;

        return [[{"text": text, "reading": ""}]];

        // ==============================
    }

    async _textParseMecab(text) {
        const jp = this._japaneseUtil;

        let parseTextResults;
        try {
            parseTextResults = await this._mecab.parseText(text);
        } catch (e) {
            return [];
        }

        const results = [];
        for (const {name, lines} of parseTextResults) {
            const result = [];
            for (const line of lines) {
                for (const {term, reading, source} of line) {
                    const termParts = [];
                    for (const {text: text2, reading: reading2} of jp.distributeFuriganaInflected(
                        term.length > 0 ? term : source,
                        jp.convertKatakanaToHiragana(reading),
                        source
                    )) {
                        termParts.push({text: text2, reading: reading2});
                    }
                    result.push(termParts);
                }
                result.push([{text: '\n', reading: ''}]);
            }
            results.push([name, result]);
        }
        return results;
    }

    _createActionListenerPort(port, sender, handlers) {
        let hasStarted = false;
        let messageString = '';

        const onProgress = (...data) => {
            try {
                if (port === null) { return; }
                port.postMessage({type: 'progress', data});
            } catch (e) {
                // NOP
            }
        };

        const onMessage = (message) => {
            if (hasStarted) { return; }

            try {
                const {action, data} = message;
                switch (action) {
                    case 'fragment':
                        messageString += data;
                        break;
                    case 'invoke':
                        {
                            hasStarted = true;
                            port.onMessage.removeListener(onMessage);

                            const messageData = JSON.parse(messageString);
                            messageString = null;
                            onMessageComplete(messageData);
                        }
                        break;
                }
            } catch (e) {
                cleanup(e);
            }
        };

        const onMessageComplete = async (message) => {
            try {
                const {action, params} = message;
                port.postMessage({type: 'ack'});

                const messageHandler = handlers.get(action);
                if (typeof messageHandler === 'undefined') {
                    throw new Error('Invalid action');
                }
                const {handler, async, contentScript} = messageHandler;

                if (!contentScript) {
                    this._validatePrivilegedMessageSender(sender);
                }

                const promiseOrResult = handler(params, sender, onProgress);
                const result = async ? await promiseOrResult : promiseOrResult;
                port.postMessage({type: 'complete', data: result});
            } catch (e) {
                cleanup(e);
            }
        };

        const onDisconnect = () => {
            cleanup(null);
        };

        const cleanup = (error) => {
            if (port === null) { return; }
            if (error !== null) {
                port.postMessage({type: 'error', data: serializeError(error)});
            }
            if (!hasStarted) {
                port.onMessage.removeListener(onMessage);
            }
            port.onDisconnect.removeListener(onDisconnect);
            port = null;
            handlers = null;
        };

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
    }

    _getErrorLevelValue(errorLevel) {
        switch (errorLevel) {
            case 'info': return 0;
            case 'debug': return 0;
            case 'warn': return 1;
            case 'error': return 2;
            default: return 0;
        }
    }

    _getModifySettingObject(target) {
        const scope = target.scope;
        switch (scope) {
            case 'profile':
                if (!isObject(target.optionsContext)) { throw new Error('Invalid optionsContext'); }
                return this._getProfileOptions(target.optionsContext, true);
            case 'global':
                return this._getOptionsFull(true);
            default:
                throw new Error(`Invalid scope: ${scope}`);
        }
    }

    _getSetting(target) {
        const options = this._getModifySettingObject(target);
        const accessor = new ObjectPropertyAccessor(options);
        const {path} = target;
        if (typeof path !== 'string') { throw new Error('Invalid path'); }
        return accessor.get(ObjectPropertyAccessor.getPathArray(path));
    }

    _modifySetting(target) {
        const options = this._getModifySettingObject(target);
        const accessor = new ObjectPropertyAccessor(options);
        const action = target.action;
        switch (action) {
            case 'set':
            {
                const {path, value} = target;
                if (typeof path !== 'string') { throw new Error('Invalid path'); }
                const pathArray = ObjectPropertyAccessor.getPathArray(path);
                accessor.set(pathArray, value);
                return accessor.get(pathArray);
            }
            case 'delete':
            {
                const {path} = target;
                if (typeof path !== 'string') { throw new Error('Invalid path'); }
                accessor.delete(ObjectPropertyAccessor.getPathArray(path));
                return true;
            }
            case 'swap':
            {
                const {path1, path2} = target;
                if (typeof path1 !== 'string') { throw new Error('Invalid path1'); }
                if (typeof path2 !== 'string') { throw new Error('Invalid path2'); }
                accessor.swap(ObjectPropertyAccessor.getPathArray(path1), ObjectPropertyAccessor.getPathArray(path2));
                return true;
            }
            case 'splice':
            {
                const {path, start, deleteCount, items} = target;
                if (typeof path !== 'string') { throw new Error('Invalid path'); }
                if (typeof start !== 'number' || Math.floor(start) !== start) { throw new Error('Invalid start'); }
                if (typeof deleteCount !== 'number' || Math.floor(deleteCount) !== deleteCount) { throw new Error('Invalid deleteCount'); }
                if (!Array.isArray(items)) { throw new Error('Invalid items'); }
                const array = accessor.get(ObjectPropertyAccessor.getPathArray(path));
                if (!Array.isArray(array)) { throw new Error('Invalid target type'); }
                return array.splice(start, deleteCount, ...items);
            }
            case 'push':
            {
                const {path, items} = target;
                if (typeof path !== 'string') { throw new Error('Invalid path'); }
                if (!Array.isArray(items)) { throw new Error('Invalid items'); }
                const array = accessor.get(ObjectPropertyAccessor.getPathArray(path));
                if (!Array.isArray(array)) { throw new Error('Invalid target type'); }
                const start = array.length;
                array.push(...items);
                return start;
            }
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    _validatePrivilegedMessageSender(sender) {
        let {url} = sender;
        if (typeof url === 'string' && yomichan.isExtensionUrl(url)) { return; }
        const {tab} = url;
        if (typeof tab === 'object' && tab !== null) {
            ({url} = tab);
            if (typeof url === 'string' && yomichan.isExtensionUrl(url)) { return; }
        }
        throw new Error('Invalid message sender');
    }

    _getBrowserIconTitle() {
        return (
            isObject(chrome.browserAction) &&
            typeof chrome.browserAction.getTitle === 'function' ?
                new Promise((resolve) => chrome.browserAction.getTitle({}, resolve)) :
                Promise.resolve('')
        );
    }

    _updateBadge() {
        let title = this._defaultBrowserActionTitle;
        if (title === null || !isObject(chrome.browserAction)) {
            // Not ready or invalid
            return;
        }

        let text = '';
        let color = null;
        let status = null;

        if (this._logErrorLevel !== null) {
            switch (this._logErrorLevel) {
                case 'error':
                    text = '!!';
                    color = '#f04e4e';
                    status = 'Error';
                    break;
                default: // 'warn'
                    text = '!';
                    color = '#f0ad4e';
                    status = 'Warning';
                    break;
            }
        } else if (!this._isPrepared) {
            if (this._prepareError) {
                text = '!!';
                color = '#f04e4e';
                status = 'Error';
            } else if (this._badgePrepareDelayTimer === null) {
                text = '...';
                color = '#f0ad4e';
                status = 'Loading';
            }
        } else {
            const options = this._getProfileOptions({current: true});
            if (!options.general.enable) {
                text = 'off';
                color = '#555555';
                status = 'Disabled';
            } else if (!this._hasRequiredPermissionsForSettings(options)) {
                text = '!';
                color = '#f0ad4e';
                status = 'Some settings require additional permissions';
            } else if (!this._isAnyDictionaryEnabled(options)) {
                text = '!';
                color = '#f0ad4e';
                status = 'No dictionaries installed';
            }
        }

        if (color !== null && typeof chrome.browserAction.setBadgeBackgroundColor === 'function') {
            chrome.browserAction.setBadgeBackgroundColor({color});
        }
        if (text !== null && typeof chrome.browserAction.setBadgeText === 'function') {
            chrome.browserAction.setBadgeText({text});
        }
        if (typeof chrome.browserAction.setTitle === 'function') {
            if (status !== null) {
                title = `${title} - ${status}`;
            }
            chrome.browserAction.setTitle({title});
        }
    }

    _isAnyDictionaryEnabled(options) {
        for (const {enabled} of options.dictionaries) {
            if (enabled) {
                return true;
            }
        }
        return false;
    }

    _anyOptionsMatches(predicate) {
        for (const {options} of this._options.profiles) {
            const value = predicate(options);
            if (value) { return value; }
        }
        return false;
    }

    async _getTabUrl(tabId) {
        try {
            const {url} = await this._sendMessageTabPromise(
                tabId,
                {action: 'Yomichan.getUrl', params: {}},
                {frameId: 0}
            );
            if (typeof url === 'string') {
                return url;
            }
        } catch (e) {
            // NOP
        }
        return null;
    }

    _getAllTabs() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({}, (tabs) => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve(tabs);
                }
            });
        });
    }

    async _findTabs(timeout, multiple, predicate, predicateIsAsync) {
        // This function works around the need to have the "tabs" permission to access tab.url.
        const tabs = await this._getAllTabs();

        let done = false;
        const checkTab = async (tab, add) => {
            const url = await this._getTabUrl(tab.id);

            if (done) { return; }

            let okay = false;
            const item = {tab, url};
            try {
                okay = predicate(item);
                if (predicateIsAsync) { okay = await okay; }
            } catch (e) {
                // NOP
            }

            if (okay && !done) {
                if (add(item)) {
                    done = true;
                }
            }
        };

        if (multiple) {
            const results = [];
            const add = (value) => {
                results.push(value);
                return false;
            };
            const checkTabPromises = tabs.map((tab) => checkTab(tab, add));
            await Promise.race([
                Promise.all(checkTabPromises),
                promiseTimeout(timeout)
            ]);
            return results;
        } else {
            const {promise, resolve} = deferPromise();
            let result = null;
            const add = (value) => {
                result = value;
                resolve();
                return true;
            };
            const checkTabPromises = tabs.map((tab) => checkTab(tab, add));
            await Promise.race([
                promise,
                Promise.all(checkTabPromises),
                promiseTimeout(timeout)
            ]);
            resolve();
            return result;
        }
    }

    async _focusTab(tab) {
        await new Promise((resolve, reject) => {
            chrome.tabs.update(tab.id, {active: true}, () => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve();
                }
            });
        });

        if (!(typeof chrome.windows === 'object' && chrome.windows !== null)) {
            // Windows not supported (e.g. on Firefox mobile)
            return;
        }

        try {
            const tabWindow = await new Promise((resolve, reject) => {
                chrome.windows.get(tab.windowId, {}, (value) => {
                    const e = chrome.runtime.lastError;
                    if (e) {
                        reject(new Error(e.message));
                    } else {
                        resolve(value);
                    }
                });
            });
            if (!tabWindow.focused) {
                await new Promise((resolve, reject) => {
                    chrome.windows.update(tab.windowId, {focused: true}, () => {
                        const e = chrome.runtime.lastError;
                        if (e) {
                            reject(new Error(e.message));
                        } else {
                            resolve();
                        }
                    });
                });
            }
        } catch (e) {
            // Edge throws exception for no reason here.
        }
    }

    _waitUntilTabFrameIsReady(tabId, frameId, timeout=null) {
        return new Promise((resolve, reject) => {
            let timer = null;
            let onMessage = (message, sender) => {
                if (
                    !sender.tab ||
                    sender.tab.id !== tabId ||
                    sender.frameId !== frameId ||
                    !isObject(message) ||
                    message.action !== 'yomichanReady'
                ) {
                    return;
                }

                cleanup();
                resolve();
            };
            const cleanup = () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (onMessage !== null) {
                    chrome.runtime.onMessage.removeListener(onMessage);
                    onMessage = null;
                }
            };

            chrome.runtime.onMessage.addListener(onMessage);

            this._sendMessageTabPromise(tabId, {action: 'Yomichan.isReady'}, {frameId})
                .then(
                    (value) => {
                        if (!value) { return; }
                        cleanup();
                        resolve();
                    },
                    () => {} // NOP
                );

            if (timeout !== null) {
                timer = setTimeout(() => {
                    timer = null;
                    cleanup();
                    reject(new Error('Timeout'));
                }, timeout);
            }
        });
    }

    async _fetchAsset(url, json=false) {
        const response = await fetch(chrome.runtime.getURL(url), {
            method: 'GET',
            mode: 'no-cors',
            cache: 'default',
            credentials: 'omit',
            redirect: 'follow',
            referrerPolicy: 'no-referrer'
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }
        return await (json ? response.json() : response.text());
    }

    _sendMessageIgnoreResponse(...args) {
        const callback = () => this._checkLastError(chrome.runtime.lastError);
        chrome.runtime.sendMessage(...args, callback);
    }

    _sendMessageTabIgnoreResponse(...args) {
        const callback = () => this._checkLastError(chrome.runtime.lastError);
        chrome.tabs.sendMessage(...args, callback);
    }

    _sendMessageAllTabsIgnoreResponse(action, params) {
        const callback = () => this._checkLastError(chrome.runtime.lastError);
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, {action, params}, callback);
            }
        });
    }

    _sendMessageTabPromise(...args) {
        return new Promise((resolve, reject) => {
            const callback = (response) => {
                try {
                    resolve(this._getMessageResponseResult(response));
                } catch (error) {
                    reject(error);
                }
            };

            chrome.tabs.sendMessage(...args, callback);
        });
    }

    _getMessageResponseResult(response) {
        let error = chrome.runtime.lastError;
        if (error) {
            throw new Error(error.message);
        }
        if (!isObject(response)) {
            throw new Error('Tab did not respond');
        }
        error = response.error;
        if (error) {
            throw deserializeError(error);
        }
        return response.result;
    }

    async _checkTabUrl(tabId, urlPredicate) {
        let tab;
        try {
            tab = await this._getTabById(tabId);
        } catch (e) {
            return null;
        }

        const url = await this._getTabUrl(tabId);
        const isValidTab = urlPredicate(url);
        return isValidTab ? tab : null;
    }

    async _getScreenshot(tabId, frameId, format, quality) {
        const tab = await this._getTabById(tabId);
        const {windowId} = tab;

        let token = null;
        try {
            if (typeof tabId === 'number' && typeof frameId === 'number') {
                const action = 'Frontend.setAllVisibleOverride';
                const params = {value: false, priority: 0, awaitFrame: true};
                token = await this._sendMessageTabPromise(tabId, {action, params}, {frameId});
            }

            return await new Promise((resolve, reject) => {
                chrome.tabs.captureVisibleTab(windowId, {format, quality}, (result) => {
                    const e = chrome.runtime.lastError;
                    if (e) {
                        reject(new Error(e.message));
                    } else {
                        resolve(result);
                    }
                });
            });
        } finally {
            if (token !== null) {
                const action = 'Frontend.clearAllVisibleOverride';
                const params = {token};
                try {
                    await this._sendMessageTabPromise(tabId, {action, params}, {frameId});
                } catch (e) {
                    // NOP
                }
            }
        }
    }

    async _injectAnkNoteMedia(ankiConnect, timestamp, definitionDetails, audioDetails, screenshotDetails, clipboardDetails, dictionaryMediaDetails) {
        let screenshotFileName = null;
        let clipboardImageFileName = null;
        let clipboardText = null;
        let audioFileName = null;
        const errors = [];

        try {
            if (screenshotDetails !== null) {
                screenshotFileName = await this._injectAnkiNoteScreenshot(ankiConnect, timestamp, definitionDetails, screenshotDetails);
            }
        } catch (e) {
            errors.push(serializeError(e));
        }

        try {
            if (clipboardDetails !== null && clipboardDetails.image) {
                clipboardImageFileName = await this._injectAnkiNoteClipboardImage(ankiConnect, timestamp, definitionDetails);
            }
        } catch (e) {
            errors.push(serializeError(e));
        }

        try {
            if (clipboardDetails !== null && clipboardDetails.text) {
                clipboardText = await this._clipboardReader.getText();
            }
        } catch (e) {
            errors.push(serializeError(e));
        }

        try {
            if (audioDetails !== null) {
                audioFileName = await this._injectAnkiNoteAudio(ankiConnect, timestamp, definitionDetails, audioDetails);
            }
        } catch (e) {
            errors.push(serializeError(e));
        }

        let dictionaryMedia;
        try {
            let errors2;
            ({results: dictionaryMedia, errors: errors2} = await this._injectAnkiNoteDictionaryMedia(ankiConnect, timestamp, definitionDetails, dictionaryMediaDetails));
            for (const error of errors2) {
                errors.push(serializeError(error));
            }
        } catch (e) {
            dictionaryMedia = [];
            errors.push(serializeError(e));
        }

        return {
            screenshotFileName,
            clipboardImageFileName,
            clipboardText,
            audioFileName,
            dictionaryMedia,
            errors: errors
        };
    }

    async _injectAnkiNoteAudio(ankiConnect, timestamp, definitionDetails, details) {
        const {type, term, reading} = definitionDetails;
        if (
            type === 'kanji' ||
            typeof term !== 'string' ||
            typeof reading !== 'string' ||
            (term.length === 0 && reading.length === 0)
        ) {
            return null;
        }

        const {sources, preferredAudioIndex, idleTimeout} = details;
        let data;
        let contentType;
        try {
            ({data, contentType} = await this._audioDownloader.downloadTermAudio(
                sources,
                preferredAudioIndex,
                term,
                reading,
                idleTimeout
            ));
        } catch (e) {
            const error = this._getAudioDownloadError(e);
            if (error !== null) { throw error; }
            // No audio
            return null;
        }

        let extension = MediaUtil.getFileExtensionFromAudioMediaType(contentType);
        if (extension === null) { extension = '.mp3'; }
        let fileName = this._generateAnkiNoteMediaFileName('yomichan_audio', extension, timestamp, definitionDetails);
        fileName = fileName.replace(/\]/g, '');
        fileName = await ankiConnect.storeMediaFile(fileName, data);

        return fileName;
    }

    async _injectAnkiNoteScreenshot(ankiConnect, timestamp, definitionDetails, details) {
        const {tabId, frameId, format, quality} = details;
        const dataUrl = await this._getScreenshot(tabId, frameId, format, quality);

        const {mediaType, data} = this._getDataUrlInfo(dataUrl);
        const extension = MediaUtil.getFileExtensionFromImageMediaType(mediaType);
        if (extension === null) {
            throw new Error('Unknown media type for screenshot image');
        }

        let fileName = this._generateAnkiNoteMediaFileName('yomichan_browser_screenshot', extension, timestamp, definitionDetails);
        fileName = await ankiConnect.storeMediaFile(fileName, data);

        return fileName;
    }

    async _injectAnkiNoteClipboardImage(ankiConnect, timestamp, definitionDetails) {
        const dataUrl = await this._clipboardReader.getImage();
        if (dataUrl === null) {
            return null;
        }

        const {mediaType, data} = this._getDataUrlInfo(dataUrl);
        const extension = MediaUtil.getFileExtensionFromImageMediaType(mediaType);
        if (extension === null) {
            throw new Error('Unknown media type for clipboard image');
        }

        let fileName = this._generateAnkiNoteMediaFileName('yomichan_clipboard_image', extension, timestamp, definitionDetails);
        fileName = await ankiConnect.storeMediaFile(fileName, data);

        return fileName;
    }

    async _injectAnkiNoteDictionaryMedia(ankiConnect, timestamp, definitionDetails, dictionaryMediaDetails) {
        const targets = [];
        const detailsList = [];
        const detailsMap = new Map();
        for (const {dictionary, path} of dictionaryMediaDetails) {
            const target = {dictionary, path};
            const details = {dictionary, path, media: null};
            const key = JSON.stringify(target);
            targets.push(target);
            detailsList.push(details);
            detailsMap.set(key, details);
        }
        const mediaList = await this._getNormalizedDictionaryDatabaseMedia(targets);

        for (const media of mediaList) {
            const {dictionary, path} = media;
            const key = JSON.stringify({dictionary, path});
            const details = detailsMap.get(key);
            if (typeof details === 'undefined' || details.media !== null) { continue; }
            details.media = media;
        }

        const errors = [];
        const results = [];
        for (let i = 0, ii = detailsList.length; i < ii; ++i) {
            const {dictionary, path, media} = detailsList[i];
            let fileName = null;
            if (media !== null) {
                const {content, mediaType} = media;
                const extension = MediaUtil.getFileExtensionFromImageMediaType(mediaType);
                fileName = this._generateAnkiNoteMediaFileName(`yomichan_dictionary_media_${i + 1}`, extension, timestamp, definitionDetails);
                try {
                    fileName = await ankiConnect.storeMediaFile(fileName, content);
                } catch (e) {
                    errors.push(e);
                    fileName = null;
                }
            }
            results.push({dictionary, path, fileName});
        }

        return {results, errors};
    }

    _getAudioDownloadError(error) {
        if (isObject(error.data)) {
            const {errors} = error.data;
            if (Array.isArray(errors)) {
                for (const error2 of errors) {
                    if (error2.name === 'AbortError') {
                        return this._createAudioDownloadError('Audio download was cancelled due to an idle timeout', 'audio-download-idle-timeout', errors);
                    }
                    if (!isObject(error2.data)) { continue; }
                    const {details} = error2.data;
                    if (!isObject(details)) { continue; }
                    if (details.error === 'net::ERR_FAILED') {
                        // This is potentially an error due to the extension not having enough URL privileges.
                        // The message logged to the console looks like this:
                        //  Access to fetch at '<URL>' from origin 'chrome-extension://<ID>' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.
                        return this._createAudioDownloadError('Audio download failed due to possible extension permissions error', 'audio-download-failed', errors);
                    }
                }
            }
        }
        return null;
    }

    _createAudioDownloadError(message, issueId, errors) {
        const error = new Error(message);
        const hasErrors = Array.isArray(errors);
        const hasIssueId = (typeof issueId === 'string');
        if (hasErrors || hasIssueId) {
            error.data = {};
            if (hasErrors) {
                // Errors need to be serialized since they are passed to other frames
                error.data.errors = errors.map((e) => serializeError(e));
            }
            if (hasIssueId) {
                error.data.referenceUrl = `/issues.html#${issueId}`;
            }
        }
        return error;
    }

    _generateAnkiNoteMediaFileName(prefix, extension, timestamp, definitionDetails) {
        let fileName = prefix;

        switch (definitionDetails.type) {
            case 'kanji':
                {
                    const {character} = definitionDetails;
                    if (character) { fileName += `_${character}`; }
                }
                break;
            default:
                {
                    const {reading, term} = definitionDetails;
                    if (reading) { fileName += `_${reading}`; }
                    if (term) { fileName += `_${term}`; }
                }
                break;
        }

        fileName += `_${this._ankNoteDateToString(new Date(timestamp))}`;
        fileName += extension;

        fileName = this._replaceInvalidFileNameCharacters(fileName);

        return fileName;
    }

    _replaceInvalidFileNameCharacters(fileName) {
        // eslint-disable-next-line no-control-regex
        return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
    }

    _ankNoteDateToString(date) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth().toString().padStart(2, '0');
        const day = date.getUTCDate().toString().padStart(2, '0');
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
    }

    _getDataUrlInfo(dataUrl) {
        const match = /^data:([^,]*?)(;base64)?,/.exec(dataUrl);
        if (match === null) {
            throw new Error('Invalid data URL');
        }

        let mediaType = match[1];
        if (mediaType.length === 0) { mediaType = 'text/plain'; }

        let data = dataUrl.substring(match[0].length);
        if (typeof match[2] === 'undefined') { data = btoa(data); }

        return {mediaType, data};
    }

    _triggerDatabaseUpdated(type, cause) {
        this._translator.clearDatabaseCaches();
        this._sendMessageAllTabsIgnoreResponse('Yomichan.databaseUpdated', {type, cause});
    }

    async _saveOptions(source) {
        this._clearProfileConditionsSchemaCache();
        const options = this._getOptionsFull();
        await this._optionsUtil.save(options);
        this._applyOptions(source);
    }

    /**
     * Creates an options object for use with `Translator.findTerms`.
     * @param {string} mode The display mode for the dictionary entries.
     * @param {{matchType: string, deinflect: boolean}} details Custom info for finding terms.
     * @param {object} options The options.
     * @returns {FindTermsOptions} An options object.
     */
    _getTranslatorFindTermsOptions(mode, details, options) {
        let {matchType, deinflect} = details;
        if (typeof matchType !== 'string') { matchType = 'exact'; }
        if (typeof deinflect !== 'boolean') { deinflect = true; }
        const enabledDictionaryMap = this._getTranslatorEnabledDictionaryMap(options);
        const {
            general: {mainDictionary, sortFrequencyDictionary, sortFrequencyDictionaryOrder},
            scanning: {alphanumeric},
            translation: {
                convertHalfWidthCharacters,
                convertNumericCharacters,
                convertAlphabeticCharacters,
                convertHiraganaToKatakana,
                convertKatakanaToHiragana,
                collapseEmphaticSequences,
                textReplacements: textReplacementsOptions
            }
        } = options;
        const textReplacements = this._getTranslatorTextReplacements(textReplacementsOptions);
        let excludeDictionaryDefinitions = null;
        if (mode === 'merge' && !enabledDictionaryMap.has(mainDictionary)) {
            enabledDictionaryMap.set(mainDictionary, {
                index: enabledDictionaryMap.size,
                priority: 0,
                allowSecondarySearches: false
            });
            excludeDictionaryDefinitions = new Set();
            excludeDictionaryDefinitions.add(mainDictionary);
        }
        return {
            matchType,
            deinflect,
            mainDictionary,
            sortFrequencyDictionary,
            sortFrequencyDictionaryOrder,
            removeNonJapaneseCharacters: !alphanumeric,
            convertHalfWidthCharacters,
            convertNumericCharacters,
            convertAlphabeticCharacters,
            convertHiraganaToKatakana,
            convertKatakanaToHiragana,
            collapseEmphaticSequences,
            textReplacements,
            enabledDictionaryMap,
            excludeDictionaryDefinitions
        };
    }

    /**
     * Creates an options object for use with `Translator.findKanji`.
     * @param {object} options The options.
     * @returns {FindKanjiOptions} An options object.
     */
    _getTranslatorFindKanjiOptions(options) {
        const enabledDictionaryMap = this._getTranslatorEnabledDictionaryMap(options);
        return {enabledDictionaryMap};
    }

    _getTranslatorEnabledDictionaryMap(options) {
        const enabledDictionaryMap = new Map();
        for (const dictionary of options.dictionaries) {
            if (!dictionary.enabled) { continue; }
            enabledDictionaryMap.set(dictionary.name, {
                index: enabledDictionaryMap.size,
                priority: dictionary.priority,
                allowSecondarySearches: dictionary.allowSecondarySearches
            });
        }
        return enabledDictionaryMap;
    }

    _getTranslatorTextReplacements(textReplacementsOptions) {
        const textReplacements = [];
        for (const group of textReplacementsOptions.groups) {
            const textReplacementsEntries = [];
            for (let {pattern, ignoreCase, replacement} of group) {
                try {
                    pattern = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
                } catch (e) {
                    // Invalid pattern
                    continue;
                }
                textReplacementsEntries.push({pattern, replacement});
            }
            if (textReplacementsEntries.length > 0) {
                textReplacements.push(textReplacementsEntries);
            }
        }
        if (textReplacements.length === 0 || textReplacementsOptions.searchOriginal) {
            textReplacements.unshift(null);
        }
        return textReplacements;
    }

    async _openWelcomeGuidePage() {
        await this._createTab(chrome.runtime.getURL('/welcome.html'));
    }

    async _openInfoPage() {
        await this._createTab(chrome.runtime.getURL('/info.html'));
    }

    async _openSettingsPage(mode) {
        const manifest = chrome.runtime.getManifest();
        const url = chrome.runtime.getURL(manifest.options_ui.page);
        switch (mode) {
            case 'existingOrNewTab':
                await new Promise((resolve, reject) => {
                    chrome.runtime.openOptionsPage(() => {
                        const e = chrome.runtime.lastError;
                        if (e) {
                            reject(new Error(e.message));
                        } else {
                            resolve();
                        }
                    });
                });
                break;
            case 'newTab':
                await this._createTab(url);
                break;
        }
    }

    _createTab(url) {
        return new Promise((resolve, reject) => {
            chrome.tabs.create({url}, (tab) => {
                const e = chrome.runtime.lastError;
                if (e) {
                    reject(new Error(e.message));
                } else {
                    resolve(tab);
                }
            });
        });
    }

    _getTabById(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.get(
                tabId,
                (result) => {
                    const e = chrome.runtime.lastError;
                    if (e) {
                        reject(new Error(e.message));
                    } else {
                        resolve(result);
                    }
                }
            );
        });
    }

    async _checkPermissions() {
        this._permissions = await this._permissionsUtil.getAllPermissions();
        this._updateBadge();
    }

    _canObservePermissionsChanges() {
        return isObject(chrome.permissions) && isObject(chrome.permissions.onAdded) && isObject(chrome.permissions.onRemoved);
    }

    _hasRequiredPermissionsForSettings(options) {
        if (!this._canObservePermissionsChanges()) { return true; }
        return this._permissions === null || this._permissionsUtil.hasRequiredPermissionsForOptions(this._permissions, options);
    }

    async _requestPersistentStorage() {
        try {
            if (await navigator.storage.persisted()) { return; }

            // Only request this permission for Firefox versions >= 77.
            // https://bugzilla.mozilla.org/show_bug.cgi?id=1630413
            const {vendor, version} = await browser.runtime.getBrowserInfo();
            if (vendor !== 'Mozilla') { return; }

            const match = /^\d+/.exec(version);
            if (match === null) { return; }

            const versionNumber = Number.parseInt(match[0]);
            if (!(Number.isFinite(versionNumber) && versionNumber >= 77)) { return; }

            await navigator.storage.persist();
        } catch (e) {
            // NOP
        }
    }

    async _getNormalizedDictionaryDatabaseMedia(targets) {
        const results = await this._dictionaryDatabase.getMedia(targets);
        for (const item of results) {
            const {content} = item;
            if (content instanceof ArrayBuffer) {
                item.content = ArrayBufferUtil.arrayBufferToBase64(content);
            }
        }
        return results;
    }
}
