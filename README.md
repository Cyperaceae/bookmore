# Book More

![release](https://img.shields.io/github/v/release/Cyperaceae/bookmore)

Quick-access buttons for Anna's Archive (ISBN/title search) and Libby (copies title) on Goodreads, StoryGraph, Douban and NeoDB.

## Installation

### Chrome / Edge

1. Download the latest `bookmore-chrome-*.zip` from the [Releases](https://github.com/Cyperaceae/bookmore/releases) page.
2. Unzip the downloaded file.
3. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the unzipped folder.

### Firefox

1. Download the latest `bookmore-firefox-*.zip` from the [Releases](https://github.com/Cyperaceae/bookmore/releases) page.
2. Go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select the downloaded ZIP file.
3. Alternatively, package or install it permanently via `about:addons`.

### Tampermonkey

Install the latest `bookmore.user.js` from the [Releases](https://github.com/Cyperaceae/bookmore/releases) page or drag it into your browser with Tampermonkey installed.

## Features

- **Anna's Archive Quick-Access**: Automatically builds ISBN and title search buttons next to the book details on Goodreads, StoryGraph, Douban, and NeoDB.
- **Libby Clipboard Copying**: Clicking the Libby button copies the cleaned book title directly to your clipboard and opens the Libby search tab.
- **Dynamic Mirror Sync**: Automatic background synchronization with a worker to fetch the best available mirror library domains.
- **Fastest Mirror Race**: Actively health-checks mirror URLs in the background and prioritizes the fastest responding working domain.
- **Platform Settings UI**: Includes a custom configuration panel on all platforms to set user overrides, monitor sync status, and inspect cached mirrors.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

## Development

This project has three build targets kept in sync under one version number:

- `chrome/` — Chrome/Edge extension (Manifest V3)
- `firefox/` — Firefox extension
- `tampermonkey/` — Userscript for Tampermonkey / Greasy Fork

To release a new version:

```bash
node scripts/sync-version.js <version>
git add . && git commit -m "chore: sync version to <version>"
git push
git tag v<version>
git push origin v<version>
```

The tag push triggers a GitHub Actions workflow that syncs the version into all three targets, packages the Chrome and Firefox builds, and creates a GitHub Release with the artifacts attached.

## License

This project is licensed under the [GNU GPLv3](LICENSE) License.
