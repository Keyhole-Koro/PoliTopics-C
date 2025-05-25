"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const recordFormat_1 = __importDefault(require("./recordFormat"));
async function fetchRecords(endpoint, params = {}) {
    const formatter = new recordFormat_1.default();
    const { from = '0000-01-01', // Default start date if not specified
    until = new Date().toISOString().split('T')[0], // Default to today
    ...otherParams } = params;
    const queryParams = new URLSearchParams({
        from,
        until,
        recordPacking: 'json',
        ...otherParams
    });
    const url = `${endpoint}?${queryParams}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('Failed to fetch records:', error);
        throw error;
    }
}
exports.default = fetchRecords;
