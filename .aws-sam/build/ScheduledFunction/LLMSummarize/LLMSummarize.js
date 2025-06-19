"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const gemini_1 = __importDefault(require("./gemini"));
const prompt_1 = require("./prompt");
async function LLMSummarize(mappedIssue, GEMINI_API_KEY) {
    const issueText = JSON.stringify(mappedIssue, null, 2);
    const result = await (0, gemini_1.default)(GEMINI_API_KEY, (0, prompt_1.compose_prompt)(issueText));
    const json_result = JSON.parse(result);
    // since dynamoDB stores id as a string, we need to convert it to string
    json_result.id = json_result.id.toString();
    return json_result;
}
exports.default = LLMSummarize;
