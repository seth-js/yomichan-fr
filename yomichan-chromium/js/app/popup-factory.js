/*
 * Copyright (C) 2019-2022  Yomichan Authors
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
 * FrameOffsetForwarder
 * Popup
 * PopupProxy
 * PopupWindow
 */

/**
 * A class which is used to generate and manage popups.
 */
class PopupFactory {
    /**
     * Creates a new instance.
     * @param {number} frameId The frame ID of the host frame.
     */
    constructor(frameId) {
        this._frameId = frameId;
        this._frameOffsetForwarder = new FrameOffsetForwarder(frameId);
        this._popups = new Map();
        this._allPopupVisibilityTokenMap = new Map();
    }

    /**
     * Prepares the instance for use.
     */
    prepare() {
        this._frameOffsetForwarder.prepare();
        yomichan.crossFrame.registerHandlers([
            ['PopupFactory.getOrCreatePopup',     {async: true,  handler: this._onApiGetOrCreatePopup.bind(this)}],
            ['PopupFactory.setOptionsContext',    {async: true,  handler: this._onApiSetOptionsContext.bind(this)}],
            ['PopupFactory.hide',                 {async: false, handler: this._onApiHide.bind(this)}],
            ['PopupFactory.isVisible',            {async: true,  handler: this._onApiIsVisibleAsync.bind(this)}],
            ['PopupFactory.setVisibleOverride',   {async: true,  handler: this._onApiSetVisibleOverride.bind(this)}],
            ['PopupFactory.clearVisibleOverride', {async: true,  handler: this._onApiClearVisibleOverride.bind(this)}],
            ['PopupFactory.containsPoint',        {async: true,  handler: this._onApiContainsPoint.bind(this)}],
            ['PopupFactory.showContent',          {async: true,  handler: this._onApiShowContent.bind(this)}],
            ['PopupFactory.setCustomCss',         {async: false, handler: this._onApiSetCustomCss.bind(this)}],
            ['PopupFactory.clearAutoPlayTimer',   {async: false, handler: this._onApiClearAutoPlayTimer.bind(this)}],
            ['PopupFactory.setContentScale',      {async: false, handler: this._onApiSetContentScale.bind(this)}],
            ['PopupFactory.updateTheme',          {async: false, handler: this._onApiUpdateTheme.bind(this)}],
            ['PopupFactory.setCustomOuterCss',    {async: false, handler: this._onApiSetCustomOuterCss.bind(this)}],
            ['PopupFactory.getFrameSize',         {async: true,  handler: this._onApiGetFrameSize.bind(this)}],
            ['PopupFactory.setFrameSize',         {async: true,  handler: this._onApiSetFrameSize.bind(this)}]
        ]);
    }

    /**
     * Gets or creates a popup based on a set of parameters
     * @param {object} details Details about how to acquire the popup.
     * @param {?number} [details.frameId] The ID of the frame that should host the popup.
     * @param {?string} [details.id] A specific ID used to find an existing popup, or to assign to the new popup.
     * @param {?string} [details.parentPopupId] The ID of the parent popup.
     * @param {?number} [details.depth] A specific depth value to assign to the popup.
     * @param {boolean} [details.popupWindow] Whether or not a separate popup window should be used, rather than an iframe.
     * @param {boolean} [details.childrenSupported] Whether or not the popup is able to show child popups.
     */
    async getOrCreatePopup({
        frameId=null,
        id=null,
        parentPopupId=null,
        depth=null,
        popupWindow=false,
        childrenSupported=false
    }) {
        // Find by existing id
        if (id !== null) {
            const popup = this._popups.get(id);
            if (typeof popup !== 'undefined') {
                return popup;
            }
        }

        // Find by existing parent id
        let parent = null;
        if (parentPopupId !== null) {
            parent = this._popups.get(parentPopupId);
            if (typeof parent !== 'undefined') {
                const popup = parent.child;
                if (popup !== null) {
                    return popup;
                }
            } else {
                parent = null;
            }
        }

        // Depth
        if (parent !== null) {
            if (depth !== null) {
                throw new Error('Depth cannot be set when parent exists');
            }
            depth = parent.depth + 1;
        } else if (depth === null) {
            depth = 0;
        }

        if (popupWindow) {
            // New unique id
            if (id === null) {
                id = generateId(16);
            }
            const popup = new PopupWindow({
                id,
                depth,
                frameId: this._frameId
            });
            this._popups.set(id, popup);
            return popup;
        } else if (frameId === this._frameId) {
            // New unique id
            if (id === null) {
                id = generateId(16);
            }
            const popup = new Popup({
                id,
                depth,
                frameId: this._frameId,
                childrenSupported
            });
            if (parent !== null) {
                if (parent.child !== null) {
                    throw new Error('Parent popup already has a child');
                }
                popup.parent = parent;
                parent.child = popup;
            }
            this._popups.set(id, popup);
            popup.prepare();
            return popup;
        } else {
            if (frameId === null) {
                throw new Error('Invalid frameId');
            }
            const useFrameOffsetForwarder = (parentPopupId === null);
            ({id, depth, frameId} = await yomichan.crossFrame.invoke(frameId, 'PopupFactory.getOrCreatePopup', {
                id,
                parentPopupId,
                frameId,
                childrenSupported
            }));
            const popup = new PopupProxy({
                id,
                depth,
                frameId,
                frameOffsetForwarder: useFrameOffsetForwarder ? this._frameOffsetForwarder : null
            });
            this._popups.set(id, popup);
            return popup;
        }
    }

    /**
     * Force all popups to have a specific visibility value.
     * @param {boolean} value Whether or not the popups should be visible.
     * @param {number} priority The priority of the override.
     * @returns {string} A token which can be passed to clearAllVisibleOverride.
     * @throws An exception is thrown if any popup fails to have its visibiltiy overridden.
     */
    async setAllVisibleOverride(value, priority) {
        const promises = [];
        const errors = [];
        for (const popup of this._popups.values()) {
            const promise = popup.setVisibleOverride(value, priority)
                .then(
                    (token) => ({popup, token}),
                    (error) => { errors.push(error); return null; }
                );
            promises.push(promise);
        }

        const results = (await Promise.all(promises)).filter(({token}) => token !== null);

        if (errors.length === 0) {
            const token = generateId(16);
            this._allPopupVisibilityTokenMap.set(token, results);
            return token;
        }

        // Revert on error
        await this._revertPopupVisibilityOverrides(results);
        throw errors[0];
    }

    /**
     * Clears a visibility override that was generated by `setAllVisibleOverride`.
     * @param {string} token The token returned from `setAllVisibleOverride`.
     * @returns {boolean} `true` if the override existed and was removed, `false` otherwise.
     */
    async clearAllVisibleOverride(token) {
        const results = this._allPopupVisibilityTokenMap.get(token);
        if (typeof results === 'undefined') { return false; }

        this._allPopupVisibilityTokenMap.delete(token);
        await this._revertPopupVisibilityOverrides(results);
        return true;
    }

    // API message handlers

    async _onApiGetOrCreatePopup(details) {
        const popup = await this.getOrCreatePopup(details);
        return {
            id: popup.id,
            depth: popup.depth,
            frameId: popup.frameId
        };
    }

    async _onApiSetOptionsContext({id, optionsContext}) {
        const popup = this._getPopup(id);
        return await popup.setOptionsContext(optionsContext);
    }

    _onApiHide({id, changeFocus}) {
        const popup = this._getPopup(id);
        return popup.hide(changeFocus);
    }

    async _onApiIsVisibleAsync({id}) {
        const popup = this._getPopup(id);
        return await popup.isVisible();
    }

    async _onApiSetVisibleOverride({id, value, priority}) {
        const popup = this._getPopup(id);
        return await popup.setVisibleOverride(value, priority);
    }

    async _onApiClearVisibleOverride({id, token}) {
        const popup = this._getPopup(id);
        return await popup.clearVisibleOverride(token);
    }

    async _onApiContainsPoint({id, x, y}) {
        const popup = this._getPopup(id);
        const offset = this._getPopupOffset(popup);
        x += offset.x;
        y += offset.y;
        return await popup.containsPoint(x, y);
    }

    async _onApiShowContent({id, details, displayDetails}) {
        const popup = this._getPopup(id);
        if (!this._popupCanShow(popup)) { return; }

        const offset = this._getPopupOffset(popup);
        const {sourceRects} = details;
        for (const sourceRect of sourceRects) {
            sourceRect.left += offset.x;
            sourceRect.top += offset.y;
            sourceRect.right += offset.x;
            sourceRect.bottom += offset.y;
        }

        return await popup.showContent(details, displayDetails);
    }

    _onApiSetCustomCss({id, css}) {
        const popup = this._getPopup(id);
        return popup.setCustomCss(css);
    }

    _onApiClearAutoPlayTimer({id}) {
        const popup = this._getPopup(id);
        return popup.clearAutoPlayTimer();
    }

    _onApiSetContentScale({id, scale}) {
        const popup = this._getPopup(id);
        return popup.setContentScale(scale);
    }

    _onApiUpdateTheme({id}) {
        const popup = this._getPopup(id);
        return popup.updateTheme();
    }

    _onApiSetCustomOuterCss({id, css, useWebExtensionApi}) {
        const popup = this._getPopup(id);
        return popup.setCustomOuterCss(css, useWebExtensionApi);
    }

    async _onApiGetFrameSize({id}) {
        const popup = this._getPopup(id);
        return await popup.getFrameSize();
    }

    async _onApiSetFrameSize({id, width, height}) {
        const popup = this._getPopup(id);
        return await popup.setFrameSize(width, height);
    }

    // Private functions

    _getPopup(id) {
        const popup = this._popups.get(id);
        if (typeof popup === 'undefined') {
            throw new Error(`Invalid popup ID ${id}`);
        }
        return popup;
    }

    _getPopupOffset(popup) {
        const {parent} = popup;
        if (parent !== null) {
            const popupRect = parent.getFrameRect();
            if (popupRect.valid) {
                return {x: popupRect.left, y: popupRect.top};
            }
        }
        return {x: 0, y: 0};
    }

    _popupCanShow(popup) {
        const parent = popup.parent;
        return parent === null || parent.isVisibleSync();
    }

    async _revertPopupVisibilityOverrides(overrides) {
        const promises = [];
        for (const value of overrides) {
            if (value === null) { continue; }
            const {popup, token} = value;
            const promise = popup.clearVisibleOverride(token)
                .then(
                    (v) => v,
                    () => false
                );
            promises.push(promise);
        }
        return await Promise.all(promises);
    }
}
