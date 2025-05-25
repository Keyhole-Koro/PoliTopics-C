"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const NationalDietAPIHandler_1 = __importDefault(require("./NationalDietAPIHandler"));
const recordFormat_1 = __importDefault(require("./recordFormat"));
async function fetchNationalDietRecords(endpoint, params = {}) {
    const formatter = new recordFormat_1.default();
    const result = await (0, NationalDietAPIHandler_1.default)(endpoint, params);
    return formatter.mapRecords(result);
}
exports.default = fetchNationalDietRecords;
