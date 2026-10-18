const { withMainActivity } = require("expo/config-plugins");

const handler = `  override fun onNewIntent(intent: Intent) {
    setIntent(intent)
    super.onNewIntent(intent)
  }

`;

function retainIntent(source) {
  let contents = source.replace(/\r\n/g, "\n");
  if (contents.includes(handler.trimEnd())) return contents;
  if (/override\s+fun\s+onNewIntent\s*\(/.test(contents)) throw new Error("Review the existing MainActivity.onNewIntent before adding intent retention.");
  if (!contents.includes("  override fun onCreate(")) throw new Error("MainActivity's Kotlin template has changed.");
  if (!contents.includes("import android.content.Intent")) contents = contents.replace(/(package [^\n]+\n)/, "$1\nimport android.content.Intent\n");
  // Linking reads Activity.intent when JavaScript starts.
  return contents.replace("  override fun onCreate(", handler + "  override fun onCreate(");
}

module.exports = config => withMainActivity(config, config => {
  if (config.modResults.language !== "kt") throw new Error("Intent retention needs a Kotlin MainActivity.");
  config.modResults.contents = retainIntent(config.modResults.contents);
  return config;
});
module.exports.retainIntent = retainIntent;
