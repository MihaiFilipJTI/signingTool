# signingTool

Automatic Apple signing tool for CI/CD usage.

## What this repository now provides

- A **macOS pipeline template** for Azure DevOps that:
  - accepts either an `.xcarchive` (distribution flow) or `.ipa` (re-sign flow)
  - authenticates to Apple Developer/App Store Connect using API key credentials
  - auto-detects the app bundle identifier
  - downloads the matching distribution provisioning profile
  - exports a signed IPA as a downloadable pipeline artifact
- A reusable script that implements all the above logic.

---

## Files

- `/scripts/sign_and_export.sh` – main automation script
- `/azure-pipelines-signing.yml` – Azure DevOps pipeline template

---

## Prerequisites

Run on a **macOS** agent with Xcode installed.

Required pipeline secret variables:

- `ASC_KEY_ID`
- `ASC_ISSUER_ID`
- `ASC_PRIVATE_KEY_BASE64` (base64-encoded `.p8` content)
- `APPLE_TEAM_ID`
- `SIGNING_IDENTITY` (for IPA re-signing, e.g. `Apple Distribution: Company Name (TEAMID)`)

Optional:

- `BUMP_VERSION` (e.g. `1.2.3`)
- `BUMP_BUILD` (e.g. `456`)

---

## How it works

### 1) XARCHIVE (`.xcarchive`) flow

1. Extracts `CFBundleIdentifier` from archive metadata.
2. Uses `fastlane sigh` with App Store Connect API key to fetch the matching App Store profile.
3. Builds `ExportOptions.plist` dynamically (bundle ID -> profile name mapping).
4. Runs `xcodebuild -exportArchive`.
5. Publishes resulting IPA as pipeline artifact `signed-ipa`.

### 2) IPA re-sign flow

1. Unzips IPA and detects app bundle identifier from `Info.plist`.
2. Downloads matching distribution profile.
3. Replaces `embedded.mobileprovision`.
4. Optionally bumps version/build in `Info.plist`.
5. Re-signs frameworks and app with provided distribution identity.
6. Repackages and publishes IPA.

---

## Azure DevOps usage

Create a pipeline from `azure-pipelines-signing.yml`, then run it manually:

- `inputPath`: absolute path to `.xcarchive` or `.ipa` on the agent
- `outputDir`: output folder on the agent

The final IPA will be available in pipeline artifacts.
