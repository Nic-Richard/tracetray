const collecting = new Map();
function startCollection(siteKey) {
    collecting.set(siteKey, (collecting.get(siteKey) || 0) + 1);
    return () => {
        const remaining = collecting.get(siteKey) - 1;
        if (remaining) collecting.set(siteKey, remaining);
        else collecting.delete(siteKey);
    };
}
const collectionPending = siteKey => collecting.has(siteKey);
module.exports = { startCollection, collectionPending };
