"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const gemini_1 = __importDefault(require("./gemini"));
const prompt_1 = require("./prompt");
async function LLMSummarize(mappedRecords, GEMINI_API_KEY) {
    const results = [];
    for (const [issueId, issue] of Object.entries(mappedRecords)) {
        const issueText = JSON.stringify(issue, null, 2);
        const reslut = await (0, gemini_1.default)(GEMINI_API_KEY, (0, prompt_1.compose_prompt)(issueText));
        results.push(JSON.parse(reslut));
    }
    return results.map(result => result);
}
exports.default = LLMSummarize;
