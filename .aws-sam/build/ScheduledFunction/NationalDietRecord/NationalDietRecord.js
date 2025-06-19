"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const NationalDietAPIHandler_1 = __importDefault(require("./NationalDietAPIHandler"));
async function fetchNationalDietRecords(endpoint, params = {}) {
    return await (0, NationalDietAPIHandler_1.default)(endpoint, params);
}
exports.default = fetchNationalDietRecords;
