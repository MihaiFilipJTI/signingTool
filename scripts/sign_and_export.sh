#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sign_and_export.sh <input_path(.xcarchive|.ipa)> <output_dir>

Environment variables:
  ASC_KEY_ID                (required)
  ASC_ISSUER_ID             (required)
  ASC_PRIVATE_KEY_BASE64    (required; base64 of .p8 file content)
  APPLE_TEAM_ID             (required)
  SIGNING_IDENTITY          (required for ipa flow)
  BUMP_VERSION              (optional for ipa flow)
  BUMP_BUILD                (optional for ipa flow)
EOF
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

plist_read() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1"
}

decode_profile_to_plist() {
  local profile_path="$1"
  local out_plist="$2"
  security cms -D -i "$profile_path" > "$out_plist"
}

prepare_api_key() {
  API_KEY_DIR="$(mktemp -d)"
  API_KEY_PATH="${API_KEY_DIR}/AuthKey_${ASC_KEY_ID}.p8"
  echo "$ASC_PRIVATE_KEY_BASE64" | base64 --decode > "$API_KEY_PATH"
}

download_profile() {
  local bundle_id="$1"
  PROFILE_DIR="$(mktemp -d)"
  PROFILE_PATH="${PROFILE_DIR}/${bundle_id}.mobileprovision"

  fastlane sigh \
    --app_identifier "$bundle_id" \
    --platform ios \
    --adhoc false \
    --development false \
    --readonly true \
    --skip_install true \
    --filename "$(basename "$PROFILE_PATH")" \
    --output_path "$PROFILE_DIR" \
    --api_key_path "$FASTLANE_API_KEY_JSON"

  if [[ ! -f "$PROFILE_PATH" ]]; then
    echo "Provisioning profile download failed for bundle id: $bundle_id" >&2
    exit 1
  fi

  PROFILE_INFO_PLIST="${PROFILE_DIR}/profile.plist"
  decode_profile_to_plist "$PROFILE_PATH" "$PROFILE_INFO_PLIST"
  PROFILE_NAME="$(plist_read "$PROFILE_INFO_PLIST" Name)"
  PROFILE_UUID="$(plist_read "$PROFILE_INFO_PLIST" UUID)"
}

setup_fastlane_api_json() {
  FASTLANE_API_KEY_JSON="$(mktemp)"
  cat > "$FASTLANE_API_KEY_JSON" <<EOF
{
  "key_id": "${ASC_KEY_ID}",
  "issuer_id": "${ASC_ISSUER_ID}",
  "key": "$(awk '{printf "%s\\n", $0}' "$API_KEY_PATH")",
  "in_house": false
}
EOF
}

detect_bundle_id_from_archive() {
  local archive_path="$1"
  local info_plist="${archive_path}/Info.plist"
  if [[ ! -f "$info_plist" ]]; then
    echo "Archive Info.plist not found: $info_plist" >&2
    exit 1
  fi
  plist_read "$info_plist" "ApplicationProperties:CFBundleIdentifier"
}

detect_bundle_id_from_ipa() {
  local ipa_path="$1"
  local work_dir="$2"
  unzip -q "$ipa_path" -d "$work_dir"
  APP_BUNDLE_PATH="$(find "$work_dir/Payload" -maxdepth 1 -name "*.app" | head -n 1)"
  if [[ -z "${APP_BUNDLE_PATH:-}" ]]; then
    echo "Invalid IPA, .app bundle not found." >&2
    exit 1
  fi
  local info_plist="${APP_BUNDLE_PATH}/Info.plist"
  plist_read "$info_plist" "CFBundleIdentifier"
}

export_archive() {
  local archive_path="$1"
  local output_dir="$2"
  local export_plist="${output_dir}/ExportOptions.plist"

  mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
  cp "$PROFILE_PATH" "$HOME/Library/MobileDevice/Provisioning Profiles/${PROFILE_UUID}.mobileprovision"

  cat > "$export_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${BUNDLE_ID}</key>
    <string>${PROFILE_NAME}</string>
  </dict>
</dict>
</plist>
EOF

  xcodebuild -exportArchive \
    -archivePath "$archive_path" \
    -exportOptionsPlist "$export_plist" \
    -exportPath "$output_dir"
}

resign_ipa() {
  local output_dir="$1"
  local embedded_profile="${APP_BUNDLE_PATH}/embedded.mobileprovision"
  local app_info="${APP_BUNDLE_PATH}/Info.plist"
  local resigned_ipa="${output_dir}/resigned.ipa"

  require_env "SIGNING_IDENTITY"
  cp "$PROFILE_PATH" "$embedded_profile"

  if [[ -n "${BUMP_VERSION:-}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${BUMP_VERSION}" "$app_info"
  fi
  if [[ -n "${BUMP_BUILD:-}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUMP_BUILD}" "$app_info"
  fi

  if [[ -d "${APP_BUNDLE_PATH}/Frameworks" ]]; then
    while IFS= read -r framework_bin; do
      codesign --force --sign "$SIGNING_IDENTITY" --timestamp --options runtime "$framework_bin"
    done < <(find "${APP_BUNDLE_PATH}/Frameworks" -type f -perm -111)
  fi

  codesign --force --sign "$SIGNING_IDENTITY" --entitlements /dev/null "$APP_BUNDLE_PATH"

  (
    cd "$IPA_WORK_DIR"
    zip -qry "$resigned_ipa" Payload
  )
}

main() {
  if [[ $# -ne 2 ]]; then
    usage
    exit 1
  fi

  local input_path="$1"
  local output_dir="$2"
  mkdir -p "$output_dir"

  require_env "ASC_KEY_ID"
  require_env "ASC_ISSUER_ID"
  require_env "ASC_PRIVATE_KEY_BASE64"
  require_env "APPLE_TEAM_ID"

  prepare_api_key
  setup_fastlane_api_json

  case "$input_path" in
    *.xcarchive)
      BUNDLE_ID="$(detect_bundle_id_from_archive "$input_path")"
      download_profile "$BUNDLE_ID"
      export_archive "$input_path" "$output_dir"
      ;;
    *.ipa)
      IPA_WORK_DIR="$(mktemp -d)"
      BUNDLE_ID="$(detect_bundle_id_from_ipa "$input_path" "$IPA_WORK_DIR")"
      download_profile "$BUNDLE_ID"
      resign_ipa "$output_dir"
      ;;
    *)
      echo "Unsupported input format: $input_path" >&2
      echo "Expected .xcarchive or .ipa" >&2
      exit 1
      ;;
  esac

  echo "Done. Signed artifact available at: $output_dir"
}

main "$@"
