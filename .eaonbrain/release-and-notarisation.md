---
title: Release and notarisation
tags: [build, macos]
created: 2026-08-02T14:43:15.851Z
updated: 2026-08-02T14:43:15.851Z
---

Signed with a Developer ID cert and notarised by Apple. electron-builder writes latest-mac.yml BEFORE notarisation, and stapling changes the bytes, so scripts/notarize-mac.mjs rewrites the manifest afterwards or every auto-update fails its checksum. GitHub also rewrites spaces in asset names to dots while the manifest uses hyphens, so assets are renamed before upload. See [[Auto update]].
