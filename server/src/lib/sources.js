// Where a visit came from, named the way an owner would say it: a search engine or app, another page on the site,
// or no referrer. Kept free of database code so feature extraction can use it too.
const NAMED = [[/google\./, "Google"], [/bing\.|duckduckgo\./, "a search engine"], [/instagram\./, "Instagram"], [/facebook\.|fb\./, "Facebook"],
    [/reddit\./, "Reddit"], [/mail\.|outlook\./, "an email"], [/t\.co$|twitter\.|x\.com$/, "X"], [/youtube\./, "YouTube"], [/pinterest\./, "Pinterest"]];

function sourceName(referrer, origin) {
    if (!referrer) return "no referrer";
    let url;
    try { url = new URL(referrer); } catch { return null; }
    if (url.origin === origin) {
        const first = url.pathname.split("/").filter(Boolean)[0];
        return !first ? "the home page" : `a ${first.replace(/s$/, "").replace(/-/g, " ")} page`;
    }
    const named = NAMED.find(([pattern]) => pattern.test(url.hostname));
    return named ? named[1] : url.hostname.replace(/^www\./, "");
}

module.exports = { sourceName };
