const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

// Without these, changing the system text size recreates the activity and resets navigation.
const HANDLED = ["fontScale", "density"];

function handleFontScale(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const current = (activity.$["android:configChanges"] || "").split("|").filter(Boolean);
  activity.$["android:configChanges"] = [...current, ...HANDLED.filter(value => !current.includes(value))].join("|");
  return manifest;
}

module.exports = config => withAndroidManifest(config, config => {
  config.modResults = handleFontScale(config.modResults);
  return config;
});
module.exports.handleFontScale = handleFontScale;
