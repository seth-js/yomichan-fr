/*
 * Copyright (C) 2022  Yomichan Authors
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
 * DocumentUtil
 * TextSourceRange
 */

/**
 * This class is a helper for handling Google Docs content in content scripts.
 */
class GoogleDocsUtil {
    /**
     * Scans the document for text or elements with text information at the given coordinate.
     * Coordinates are provided in [client space](https://developer.mozilla.org/en-US/docs/Web/CSS/CSSOM_View/Coordinate_systems).
     * @param {number} x The x coordinate to search at.
     * @param {number} y The y coordinate to search at.
     * @param {GetRangeFromPointOptions} options Options to configure how element detection is performed.
     * @returns {?TextSourceRange|TextSourceElement} A range for the hovered text or element, or `null` if no applicable content was found.
     */
    static getRangeFromPoint(x, y, {normalizeCssZoom}) {
        const styleNode = this._getStyleNode();
        styleNode.disabled = false;
        const element = document.elementFromPoint(x, y);
        styleNode.disabled = true;
        if (element !== null && element.matches('.kix-canvas-tile-content svg>g>rect')) {
            const ariaLabel = element.getAttribute('aria-label');
            if (typeof ariaLabel === 'string' && ariaLabel.length > 0) {
                return this._createRange(element, ariaLabel, x, y, normalizeCssZoom);
            }
        }
        return null;
    }

    static _getStyleNode() {
        // This <style> node is necessary to force the SVG <rect> elements to have a fill,
        // which allows them to be included in document.elementsFromPoint's return value.
        if (this._styleNode === null) {
            const style = document.createElement('style');
            style.textContent = [
                '.kix-canvas-tile-content{pointer-events:none!important;}',
                '.kix-canvas-tile-content svg>g>rect{pointer-events:all!important;}'
            ].join('\n');
            const parent = document.head || document.documentElement;
            if (parent !== null) {
                parent.appendChild(style);
            }
            this._styleNode = style;
        }
        return this._styleNode;
    }

    static _createRange(element, text, x, y, normalizeCssZoom) {
        // Create imposter
        const content = document.createTextNode(text);
        const svgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const transform = element.getAttribute('transform') || '';
        const font = element.getAttribute('data-font-css') || '';
        svgText.setAttribute('x', element.getAttribute('x'));
        svgText.setAttribute('y', element.getAttribute('y'));
        svgText.appendChild(content);
        const textStyle = svgText.style;
        this._setImportantStyle(textStyle, 'all', 'initial');
        this._setImportantStyle(textStyle, 'transform', transform);
        this._setImportantStyle(textStyle, 'font', font);
        this._setImportantStyle(textStyle, 'text-anchor', 'start');
        element.parentNode.appendChild(svgText);

        // Adjust offset
        const elementRect = element.getBoundingClientRect();
        const textRect = svgText.getBoundingClientRect();
        const yOffset = ((elementRect.top - textRect.top) + (elementRect.bottom - textRect.bottom)) * 0.5;
        this._setImportantStyle(textStyle, 'transform', `translate(0px,${yOffset}px) ${transform}`);

        // Create range
        const range = this._getRangeWithPoint(content, x, y, normalizeCssZoom);
        this._setImportantStyle(textStyle, 'pointer-events', 'none');
        this._setImportantStyle(textStyle, 'opacity', '0');
        return TextSourceRange.createFromImposter(range, svgText, element);
    }

    static _getRangeWithPoint(textNode, x, y, normalizeCssZoom) {
        if (normalizeCssZoom) {
            const scale = DocumentUtil.computeZoomScale(textNode);
            x /= scale;
            y /= scale;
        }
        const range = document.createRange();
        let start = 0;
        let end = textNode.nodeValue.length;
        while (end - start > 1) {
            const mid = Math.floor((start + end) / 2);
            range.setStart(textNode, mid);
            range.setEnd(textNode, end);
            if (DocumentUtil.isPointInAnyRect(x, y, range.getClientRects())) {
                start = mid;
            } else {
                end = mid;
            }
        }
        range.setStart(textNode, start);
        range.setEnd(textNode, start);
        return range;
    }

    static _setImportantStyle(style, propertyName, value) {
        style.setProperty(propertyName, value, 'important');
    }
}
// eslint-disable-next-line no-underscore-dangle
GoogleDocsUtil._styleNode = null;
