import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateStoryPage, CHARS_PER_LINE, LINES_PER_PAGE, CHARS_PER_PAGE,
    PAGES_PER_BOOK,
} from "../lib/book.core.ts";

const FIELDS = {
    name: "Dolores Xiao",
    occupation: "cook",
    hometown: "a village your parents never stopped talking about",
    causeOfDeath: "a fall — stupid, domestic, final",
};
const STORY_TEXT = "Your name was Dolores Xiao. You were a cook. You died.";

describe("generateStoryPage", () => {
    it("returns a non-empty string", () => {
        const page = generateStoryPage(STORY_TEXT, FIELDS, 0);
        assert.ok(page.length > 0);
    });

    it("is deterministic — same inputs = same output", () => {
        const a = generateStoryPage(STORY_TEXT, FIELDS, 5);
        const b = generateStoryPage(STORY_TEXT, FIELDS, 5);
        assert.strictEqual(a, b);
    });

    it("different pages produce different content", () => {
        const pages = new Set();
        for (let i = 0; i < 20; i++) {
            pages.add(generateStoryPage(STORY_TEXT, FIELDS, i));
        }
        assert.ok(pages.size > 10, "most pages should be unique");
    });

    it("lines are at most CHARS_PER_LINE wide", () => {
        const page = generateStoryPage(STORY_TEXT, FIELDS, 42);
        const lines = page.split("\n");
        for (const line of lines) {
            assert.ok(line.length <= CHARS_PER_LINE,
                `line too long: ${line.length} > ${CHARS_PER_LINE}`);
        }
    });

    it("has at most LINES_PER_PAGE lines", () => {
        const page = generateStoryPage(STORY_TEXT, FIELDS, 0);
        const lines = page.split("\n");
        assert.ok(lines.length <= LINES_PER_PAGE,
            `too many lines: ${lines.length}`);
    });

    it("fills roughly a full page", () => {
        const page = generateStoryPage(STORY_TEXT, FIELDS, 7);
        // Should fill most of the page (at least 80%)
        assert.ok(page.length >= CHARS_PER_PAGE * 0.8,
            `page too short: ${page.length} < ${CHARS_PER_PAGE * 0.8}`);
    });

    it("contains readable English, not random ASCII", () => {
        const page = generateStoryPage(STORY_TEXT, FIELDS, 0);
        // Should contain common English words
        assert.ok(page.includes("You"), "should contain 'You'");
        // Should have spaces (prose, not symbol noise)
        const spaceRatio = (page.match(/ /g) || []).length / page.length;
        assert.ok(spaceRatio > 0.1, "should have plenty of spaces (prose)");
    });

    it("interpolates the person's name", () => {
        // Run enough pages — name appears in openers and occupation fillers
        let found = false;
        for (let i = 0; i < 50; i++) {
            const page = generateStoryPage(STORY_TEXT, FIELDS, i);
            if (page.includes("Dolores Xiao")) { found = true; break; }
        }
        assert.ok(found, "name should appear in at least some pages");
    });

    it("interpolates the occupation", () => {
        let found = false;
        for (let i = 0; i < 50; i++) {
            const page = generateStoryPage(STORY_TEXT, FIELDS, i);
            if (page.includes("cook")) { found = true; break; }
        }
        assert.ok(found, "occupation should appear in at least some pages");
    });

    it("different people get different tedium", () => {
        const other = {
            name: "Marcus Crane",
            occupation: "dentist",
            hometown: "a city you mostly tried to leave",
            causeOfDeath: "cancer, which took its time",
        };
        const otherStory = "Your name was Marcus Crane. You were a dentist.";
        const pageA = generateStoryPage(STORY_TEXT, FIELDS, 0);
        const pageB = generateStoryPage(otherStory, other, 0);
        assert.notStrictEqual(pageA, pageB);
    });

    it("works for all 410 pages without error", () => {
        for (let i = 0; i < PAGES_PER_BOOK; i++) {
            const page = generateStoryPage(STORY_TEXT, FIELDS, i);
            assert.ok(page.length > 0, `page ${i} is empty`);
        }
    });
});

describe("life arc structure", () => {
    it("early pages (birth) mention being born/small/learning", () => {
        let birthContent = "";
        for (let i = 0; i < 8; i++) {
            birthContent += generateStoryPage(STORY_TEXT, FIELDS, i) + " ";
        }
        const birthWords = ["born", "small", "walk", "name", "cried", "learned"];
        const found = birthWords.filter(w => birthContent.includes(w));
        assert.ok(found.length >= 2,
            `birth pages should contain birth-related words, found: ${found}`);
    });

    it("middle pages (working life) mention work/occupation", () => {
        let workContent = "";
        // Sample a few pages from the working-life phase
        for (const p of [50, 100, 200, 300]) {
            workContent += generateStoryPage(STORY_TEXT, FIELDS, p) + " ";
        }
        assert.ok(workContent.includes("cook") || workContent.includes("work"),
            "working-life pages should mention work or occupation");
    });

    it("late pages (aging) mention slowing down", () => {
        let agingContent = "";
        for (let i = 375; i < 400; i++) {
            agingContent += generateStoryPage(STORY_TEXT, FIELDS, i) + " ";
        }
        const agingWords = ["slower", "doctor", "stairs", "pills", "mirror", "hurt", "nap"];
        const found = agingWords.filter(w => agingContent.includes(w));
        assert.ok(found.length >= 2,
            `aging pages should contain aging-related words, found: ${found}`);
    });

    it("final pages (death) mention dying/stopping/ending", () => {
        let deathContent = "";
        for (let i = 400; i < PAGES_PER_BOOK; i++) {
            deathContent += generateStoryPage(STORY_TEXT, FIELDS, i) + " ";
        }
        const deathWords = ["stopped", "quiet", "over", "wrong", "tired", "library"];
        const found = deathWords.filter(w => deathContent.includes(w));
        assert.ok(found.length >= 2,
            `death pages should contain death-related words, found: ${found}`);
    });

    it("birth pages do NOT mention death or aging", () => {
        let birthContent = "";
        for (let i = 0; i < 8; i++) {
            birthContent += generateStoryPage(STORY_TEXT, FIELDS, i) + " ";
        }
        assert.ok(!birthContent.includes("stopped"),
            "birth pages should not mention death");
        assert.ok(!birthContent.includes("pills"),
            "birth pages should not mention aging");
    });

    it("death pages do NOT mention being born or school", () => {
        let deathContent = "";
        for (let i = 400; i < PAGES_PER_BOOK; i++) {
            deathContent += generateStoryPage(STORY_TEXT, FIELDS, i) + " ";
        }
        assert.ok(!deathContent.includes("born"),
            "death pages should not mention birth");
        assert.ok(!deathContent.includes("school"),
            "death pages should not mention school");
    });
});
