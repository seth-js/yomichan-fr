/*
 * Copyright (C) 2020-2022  Yomichan Authors
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
 * PanelElement
 */

class Modal extends PanelElement {
    constructor(node) {
        super({
            node,
            closingAnimationDuration: 375 // Milliseconds; includes buffer
        });
        this._contentNode = null;
        this._canCloseOnClick = false;
    }

    prepare() {
        const node = this.node;
        this._contentNode = node.querySelector('.modal-content');
        let dimmerNode = node.querySelector('.modal-content-dimmer');
        if (dimmerNode === null) { dimmerNode = node; }
        dimmerNode.addEventListener('mousedown', this._onModalContainerMouseDown.bind(this), false);
        dimmerNode.addEventListener('mouseup', this._onModalContainerMouseUp.bind(this), false);
        dimmerNode.addEventListener('click', this._onModalContainerClick.bind(this), false);

        for (const actionNode of node.querySelectorAll('[data-modal-action]')) {
            actionNode.addEventListener('click', this._onActionNodeClick.bind(this), false);
        }
    }

    // Private

    _onModalContainerMouseDown(e) {
        this._canCloseOnClick = (e.currentTarget === e.target);
    }

    _onModalContainerMouseUp(e) {
        if (!this._canCloseOnClick) { return; }
        this._canCloseOnClick = (e.currentTarget === e.target);
    }

    _onModalContainerClick(e) {
        if (!this._canCloseOnClick) { return; }
        this._canCloseOnClick = false;
        if (e.currentTarget !== e.target) { return; }
        this.setVisible(false);
    }

    _onActionNodeClick(e) {
        const {modalAction} = e.currentTarget.dataset;
        switch (modalAction) {
            case 'expand':
                this._setExpanded(true);
                break;
            case 'collapse':
                this._setExpanded(false);
                break;
        }
    }

    _setExpanded(expanded) {
        if (this._contentNode === null) { return; }
        this._contentNode.classList.toggle('modal-content-full', expanded);
    }
}
