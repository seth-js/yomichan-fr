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
 * AnkiUtil
 */

class AnkiConnect {
    constructor() {
        this._enabled = false;
        this._server = null;
        this._localVersion = 2;
        this._remoteVersion = 0;
        this._versionCheckPromise = null;
        this._apiKey = null;
    }

    get server() {
        return this._server;
    }

    set server(value) {
        this._server = value;
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
    }

    get apiKey() {
        return this._apiKey;
    }

    set apiKey(value) {
        this._apiKey = value;
    }

    async isConnected() {
        try {
            await this._invoke('version');
            return true;
        } catch (e) {
            return false;
        }
    }

    async getVersion() {
        if (!this._enabled) { return null; }
        await this._checkVersion();
        return await this._invoke('version', {});
    }

    async addNote(note) {
        if (!this._enabled) { return null; }
        await this._checkVersion();
        return await this._invoke('addNote', {note});
    }

    async canAddNotes(notes) {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('canAddNotes', {notes});
    }

    async notesInfo(notes) {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('notesInfo', {notes});
    }

    async getDeckNames() {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('deckNames');
    }

    async getModelNames() {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('modelNames');
    }

    async getModelFieldNames(modelName) {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('modelFieldNames', {modelName});
    }

    async guiBrowse(query) {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('guiBrowse', {query});
    }

    async guiBrowseNote(noteId) {
        return await this.guiBrowse(`nid:${noteId}`);
    }

    /**
     * Opens the note editor GUI.
     * @param {number} noteId The ID of the note.
     * @returns {Promise<null>} Nothing is returned.
     */
    async guiEditNote(noteId) {
        return await this._invoke('guiEditNote', {note: noteId});
    }

    /**
     * Stores a file with the specified base64-encoded content inside Anki's media folder.
     * @param {string} fileName The name of the file.
     * @param {string} content The base64-encoded content of the file.
     * @returns {?string} The actual file name used to store the file, which may be different; or `null` if the file was not stored.
     * @throws {Error} An error is thrown is this object is not enabled.
     */
    async storeMediaFile(fileName, content) {
        if (!this._enabled) {
            throw new Error('AnkiConnect not enabled');
        }
        await this._checkVersion();
        return await this._invoke('storeMediaFile', {filename: fileName, data: content});
    }

    /**
     * Finds notes matching a query.
     * @param {string} query Searches for notes matching a query.
     * @returns {number[]} An array of note IDs.
     * @see https://docs.ankiweb.net/searching.html
     */
    async findNotes(query) {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('findNotes', {query});
    }

    async findNoteIds(notes) {
        if (!this._enabled) { return []; }
        await this._checkVersion();

        const actions = [];
        const actionsTargetsList = [];
        const actionsTargetsMap = new Map();
        const allNoteIds = [];

        for (const note of notes) {
            const query = this._getNoteQuery(note);
            let actionsTargets = actionsTargetsMap.get(query);
            if (typeof actionsTargets === 'undefined') {
                actionsTargets = [];
                actionsTargetsList.push(actionsTargets);
                actionsTargetsMap.set(query, actionsTargets);
                actions.push({action: 'findNotes', params: {query}});
            }
            const noteIds = [];
            allNoteIds.push(noteIds);
            actionsTargets.push(noteIds);
        }

        const result = await this._invoke('multi', {actions});
        for (let i = 0, ii = Math.min(result.length, actionsTargetsList.length); i < ii; ++i) {
            const noteIds = result[i];
            for (const actionsTargets of actionsTargetsList[i]) {
                for (const noteId of noteIds) {
                    actionsTargets.push(noteId);
                }
            }
        }
        return allNoteIds;
    }

    async suspendCards(cardIds) {
        if (!this._enabled) { return false; }
        await this._checkVersion();
        return await this._invoke('suspend', {cards: cardIds});
    }

    async findCards(query) {
        if (!this._enabled) { return []; }
        await this._checkVersion();
        return await this._invoke('findCards', {query});
    }

    async findCardsForNote(noteId) {
        return await this.findCards(`nid:${noteId}`);
    }

    /**
     * Gets information about the AnkiConnect APIs available.
     * @param {string[]} scopes A list of scopes to get information about.
     * @param {?string[]} actions A list of actions to check for
     * @returns {object} Information about the APIs.
     */
    async apiReflect(scopes, actions=null) {
        return await this._invoke('apiReflect', {scopes, actions});
    }

    /**
     * Checks whether a specific API action exists.
     * @param {string} action The action to check for.
     * @returns {boolean} Whether or not the action exists.
     */
    async apiExists(action) {
        const {actions} = await this.apiReflect(['actions'], [action]);
        return actions.includes(action);
    }

    /**
     * Checks if a specific error object corresponds to an unsupported action.
     * @param {Error} error An error object generated by an API call.
     * @returns {boolean} Whether or not the error indicates the action is not supported.
     */
    isErrorUnsupportedAction(error) {
        if (error instanceof Error) {
            const {data} = error;
            if (isObject(data) && data.apiError === 'unsupported action') {
                return true;
            }
        }
        return false;
    }

    // Private

    async _checkVersion() {
        if (this._remoteVersion < this._localVersion) {
            if (this._versionCheckPromise === null) {
                const promise = this._invoke('version');
                promise
                    .catch(() => {})
                    .finally(() => { this._versionCheckPromise = null; });
                this._versionCheckPromise = promise;
            }
            this._remoteVersion = await this._versionCheckPromise;
            if (this._remoteVersion < this._localVersion) {
                throw new Error('Extension and plugin versions incompatible');
            }
        }
    }

    async _invoke(action, params) {
        const body = {action, params, version: this._localVersion};
        if (this._apiKey !== null) { body.key = this._apiKey; }
        let response;
        try {
            response = await fetch(this._server, {
                method: 'POST',
                mode: 'cors',
                cache: 'default',
                credentials: 'omit',
                headers: {
                    'Content-Type': 'application/json'
                },
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify(body)
            });
        } catch (e) {
            const error = new Error('Anki connection failure');
            error.data = {action, params, originalError: e};
            throw error;
        }

        if (!response.ok) {
            const error = new Error(`Anki connection error: ${response.status}`);
            error.data = {action, params, status: response.status};
            throw error;
        }

        let responseText = null;
        let result;
        try {
            responseText = await response.text();
            result = JSON.parse(responseText);
        } catch (e) {
            const error = new Error('Invalid Anki response');
            error.data = {action, params, status: response.status, responseText, originalError: e};
            throw error;
        }

        if (isObject(result)) {
            const apiError = result.error;
            if (typeof apiError !== 'undefined') {
                const error = new Error(`Anki error: ${apiError}`);
                error.data = {action, params, status: response.status, apiError};
                throw error;
            }
        }

        return result;
    }

    _escapeQuery(text) {
        return text.replace(/"/g, '');
    }

    _fieldsToQuery(fields) {
        const fieldNames = Object.keys(fields);
        if (fieldNames.length === 0) {
            return '';
        }

        const key = fieldNames[0];
        return `"${key.toLowerCase()}:${this._escapeQuery(fields[key])}"`;
    }

    _getDuplicateScopeFromNote(note) {
        const {options} = note;
        if (typeof options === 'object' && options !== null) {
            const {duplicateScope} = options;
            if (typeof duplicateScope !== 'undefined') {
                return duplicateScope;
            }
        }
        return null;
    }

    _getNoteQuery(note) {
        let query = '';
        switch (this._getDuplicateScopeFromNote(note)) {
            case 'deck':
                query = `"deck:${this._escapeQuery(note.deckName)}" `;
                break;
            case 'deck-root':
                query = `"deck:${this._escapeQuery(AnkiUtil.getRootDeckName(note.deckName))}" `;
                break;
        }
        query += this._fieldsToQuery(note.fields);
        return query;
    }
}
