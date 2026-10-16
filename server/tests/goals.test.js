const assert = require("node:assert/strict");
const { test } = require("node:test");
const { eventHits, pageGoalMarks, journeysOf, parseGoal, matchChanged, appliesTo } = require("../src/lib/goals");

const site = "https://shop.example";
const click = (target, extra = {}) => ({ type: "click", tag: "SPAN", text: "icon", target, ...extra });

test("click goals match the button by id, link destination or label, whatever was clicked inside it", () => {
    const byText = { id: "g1", type: "click", match: { text: "Start free trial", tag: "BUTTON" }, pages: [] };
    const byHref = { id: "g2", type: "click", match: { href: "/pricing" }, pages: [] };
    const byId = { id: "g3", type: "click", match: { id: "buy" }, pages: [] };
    const session = { page: `${site}/`, page_path: "/" };
    assert.deepEqual(eventHits([byText, byHref, byId], session, [click({ tag: "BUTTON", id: null, text: "start  FREE trial", href: null })]), ["g1"]);
    assert.deepEqual(eventHits([byText, byHref, byId], session, [click({ tag: "A", id: null, text: "Plans", href: "/pricing" })]), ["g2"]);
    assert.deepEqual(eventHits([byText, byHref, byId], session, [click({ tag: "BUTTON", id: "buy", text: "Buy", href: null })]), ["g3"]);
    assert.deepEqual(eventHits([byText], session, [{ type: "scroll" }, click(null)]), []);
});

test("clicks recorded before the tracker named the button still match on the element itself", () => {
    const goal = { id: "g1", type: "click", match: { text: "Buy now" }, pages: [] };
    assert.deepEqual(eventHits([goal], { page: `${site}/` }, [{ type: "tap", tag: "BUTTON", id: null, text: "Buy now" }]), ["g1"]);
});

test("a goal limited to some pages only counts there, by group or by real address", () => {
    const goal = { id: "g1", type: "click", match: { text: "Add to cart" }, pages: [`${site}/products/:product`] };
    assert.equal(appliesTo(goal, { page: `${site}/products/:product`, page_path: "/products/tent" }), true);
    assert.equal(appliesTo(goal, { page: `${site}/`, page_path: "/" }), false);
    const single = { ...goal, pages: [`${site}/products/tent`] };
    assert.equal(appliesTo(single, { page: `${site}/products/:product`, page_path: "/products/tent" }), true);
});

test("page goals mark the earlier pages of a journey that reaches the goal page, not the goal page itself", () => {
    const goal = { id: "g1", type: "page", match: { page: `${site}/thanks` }, pages: [] };
    const at = minutes => Date.UTC(2026, 9, 15, 12, minutes);
    const visits = [
        { session_id: "a", page: `${site}/`, page_path: "/", start_time: at(0) },
        { session_id: "b", page: `${site}/pricing`, page_path: "/pricing", start_time: at(5) },
        { session_id: "c", page: `${site}/thanks`, page_path: "/thanks", start_time: at(8) },
        { session_id: "d", page: `${site}/`, page_path: "/", start_time: at(60) }
    ];
    const journeys = journeysOf(visits);
    assert.equal(journeys.length, 2);
    assert.deepEqual([...pageGoalMarks([goal], journeys[0]).keys()], ["a", "b"]);
    assert.equal(pageGoalMarks([goal], journeys[1]).size, 0);
});

test("goal input is checked and cleaned, and only match or page changes need past visits rechecked", () => {
    assert.match(parseGoal({ type: "click", name: "Trial", match: {} }).error, /button or link/);
    assert.match(parseGoal({ type: "page", name: "Thanks", match: { page: "/thanks" } }).error, /page/);
    assert.match(parseGoal({ type: "visit", name: "x" }).error, /click, form or page goal/);
    const { goal } = parseGoal({ type: "click", name: "  Start   trial ", match: { text: " Start  free trial ", tag: "button" }, pages: ["javascript:x", `${site}/`] });
    assert.equal(goal.name, "Start trial");
    assert.deepEqual(goal.match, { id: null, href: null, text: "Start free trial", tag: "BUTTON" });
    assert.deepEqual(goal.pages, [`${site}/`]);
    assert.ok(/^g[\w-]{8}$/.test(goal.id));
    const renamed = parseGoal({ name: "Trial button" }, goal).goal;
    assert.equal(renamed.id, goal.id);
    assert.equal(matchChanged(goal, renamed), false);
    assert.equal(matchChanged(goal, parseGoal({ name: "x", match: { text: "Buy" } }, goal).goal), true);
});

test("before-and-after only calls a goal change once it's unlikely to be chance", () => {
    const { goalVerdict } = require("../src/lib/compare");
    const side = (visits, goalReached) => ({ visits, goalReached });
    assert.equal(goalVerdict(side(400, 8), side(400, 14)), "unclear");
    assert.equal(goalVerdict(side(1000, 40), side(1000, 75)), "better");
    assert.equal(goalVerdict(side(1000, 75), side(1000, 40)), "worse");
    assert.equal(goalVerdict(side(1000, 50), side(1000, 56)), "same");
    assert.equal(goalVerdict(side(0, 0), side(1000, 80)), "unclear");
});

test("a goal's target is a share of visits, kept through renames and clearable", () => {
    const { goal } = parseGoal({ type: "page", name: "Checkout", match: { page: "https://shop.example/checkout" }, target: 0.05 });
    assert.equal(goal.target, 0.05);
    assert.equal(parseGoal({ name: "Checkout page" }, goal).goal.target, 0.05);
    assert.equal(parseGoal({ name: "Checkout", target: null }, goal).goal.target, null);
    assert.match(parseGoal({ name: "Checkout", target: 5 }, goal).error, /between 0% and 100%/);
});

test("form goals match a sent form by id, else name, else where it posts, and never by field values", () => {
    const sent = form => ({ type: "form_submit", form });
    const byId = { id: "f1", type: "form", match: { id: "signup" }, pages: [] };
    const byName = { id: "f2", type: "form", match: { name: "contact" }, pages: [] };
    const byAction = { id: "f3", type: "form", match: { action: "/subscribe" }, pages: [] };
    const session = { page: `${site}/`, page_path: "/" };
    assert.deepEqual(eventHits([byId, byName, byAction], session, [sent({ id: "signup", name: null, action: "/join" })]), ["f1"]);
    assert.deepEqual(eventHits([byId, byName, byAction], session, [sent({ id: null, name: "contact", action: "/x" })]), ["f2"]);
    assert.deepEqual(eventHits([byId, byName, byAction], session, [sent({ id: null, name: null, action: "/subscribe" })]), ["f3"]);
    assert.deepEqual(eventHits([byId], session, [click({ tag: "BUTTON", id: "signup", text: "Sign up", href: null })]), []);
    assert.match(parseGoal({ type: "form", name: "Signup", match: {} }).error, /form/);
    assert.deepEqual(parseGoal({ type: "form", name: "Signup", match: { id: " signup " } }).goal.match, { id: "signup", name: null, action: null });
});

test("a funnel counts steps reached in order, ignoring pages in between", () => {
    const { parsePath, stepsReached } = require("../src/lib/paths");
    const steps = [`${site}/products/:product`, `${site}/cart`, `${site}/checkout`];
    const visit = (page, path) => ({ page: `${site}${page}`, page_path: path });
    assert.equal(stepsReached([visit("/", "/"), visit("/products/:product", "/products/tent"), visit("/journal", "/journal"), visit("/cart", "/cart")], steps), 2);
    assert.equal(stepsReached([visit("/cart", "/cart"), visit("/products/:product", "/products/tent")], steps), 1);
    assert.equal(stepsReached([visit("/products/:product", "/products/a"), visit("/cart", "/cart"), visit("/checkout", "/checkout")], steps), 3);
    assert.match(parsePath({ name: "Buy", steps: [steps[0]] }).error, /2 to 6/);
    assert.match(parsePath({ name: "Buy", steps: [steps[0], steps[0]] }).error, /only be one step/);
    assert.deepEqual(parsePath({ name: " Buy ", steps }).path.steps, steps);
});
