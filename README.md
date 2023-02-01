# yomichan-fr 🇫🇷


### A French hover dictionary. It's a modified version of Yomichan that works with French.


#### Examples:
![example-1](https://user-images.githubusercontent.com/83692925/216156508-f93ed647-0c77-44d6-bed1-f8aae6372c1a.png)
![example-2](https://user-images.githubusercontent.com/83692925/216156577-2036ab5c-d13a-468f-a3c5-9a16319f1272.png)


### Instructions (firefox)
1. Download the repository, clone it, whatever.
2. Download the JSON and two zips from the release section.
3. Go to: about:debugging#/runtime/this-firefox
4. Click `Load Temporary Add-on`…
5. Navigate to the `manifest.json` in the repository and choose it.

Yomichan should now be installed.

6. Head to the bottom of the Yomichan settings page.
7. Select `Import Settings`.
8. Choose `yomichan-settings-2023-02-01.json`
9. Go to the `Dictionaries` section and import `French Dictionary.zip`

### Instructions (chromium-based)
1. Download the repository, clone it, whatever.
2. Download the JSON and two zips from the release section.
3. Go to: chrome://extensions/
4. Turn on `Developer mode`
5. Click `Load unpacked`
6. Navigate to the folder where `manifest.json` is in the repository, and select the folder.

Yomichan should now be installed.

7. Head to the bottom of the Yomichan settings page.
8. Select `Import Settings`.
9. Choose `yomichan-settings-2023-02-01.json`
10. Go to the `Dictionaries` section and import `French Dictionary.zip`

Everything should now be set up for Yomichan.

To get the Forvo server working, unzip the `French Forvo` folder from `French Forvo.zip`, and throw it in your Anki addon folder. Mine's in `C:\Users\[Username]\AppData\Roaming\Anki2\addons21`. Then install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) and restart Anki.

I should also mention that another feature I added is the ability to hear the inflected version of the word you've clicked on. By clicking the sound button while holding the Alt key, it will play the inflected version (ex. joue instead of jouer).

### Notes

If you are already using Yomichan for Japanese, consider using this extension in a separate browser profile. This is a modified version of Yomichan and the unmodified version will have unintended results.

The dictionary takes data from [Kaikki's French Wiktionary dump](https://kaikki.org/dictionary/French/) and specially formats it to work with this custom version of Yomichan. It contains over ~135,000 lemmas. That sounds like a lot, but there are still cases where you'll encounter a word that doesn't have a definition.

Many thanks to [Tatu Ylonen](http://www.lrec-conf.org/proceedings/lrec2022/pdf/2022.lrec-1.140.pdf)'s project [Wiktextract](https://github.com/tatuylonen/wiktextract). Without it, this project, and others I've made like it wouldn't exist.

The Firefox extension unfortunately doesn't survive restarts. This means you'll have to add it through the debugging page each time, although your settings and the dictionary will not be lost.

Chrome is planning to drop support for extensions that use Manifest V2. This means that unless the developer for Yomichan updates it by then, Chrome may no longer be supported.

Frequency data was created from parsing the [OpenSubtitles](http://www.opensubtitles.org/) French [corpus](https://opus.nlpl.eu/OpenSubtitles-v2018.php). The parser used the Kaikki data as well. Phrases like "faire un carton" were correctly parsed as such rather than seperately as "faire", "un", and "carton". Words found in the 95% coverage list I created are marked as popular.
