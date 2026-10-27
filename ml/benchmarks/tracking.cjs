const { trackGroups } = require("../../server/src/lib/groupTracking");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
    const results = JSON.parse(input).map(({ before, after }) => {
        before.ran_at = "2026-10-01T00:00:00Z";
        after.ran_at = "2026-10-08T00:00:00Z";
        trackGroups(null, before);
        trackGroups(before, after);
        const newGroups = after.clusters.filter(c => c.track.new).length;
        const wrong = after.clusters.filter(c => !c.track.new && before.clusters.find(p => p.id === c.track.previous_id)?.truth !== c.truth).length;
        return { groups: after.clusters.length, new_groups: newGroups, wrong_matches: wrong };
    });
    process.stdout.write(JSON.stringify(results));
});
