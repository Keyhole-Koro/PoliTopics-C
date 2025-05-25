"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSpeech = void 0;
// Type guards for runtime type checking
const isSpeech = (obj) => {
    return obj &&
        typeof obj.speechOrder === 'number' &&
        typeof obj.speaker === 'string' &&
        typeof obj.speakerYomi === 'string' &&
        typeof obj.speakerGroup === 'string' &&
        typeof obj.speakerPosition === 'string' &&
        typeof obj.speakerRole === 'string' &&
        typeof obj.speech === 'string';
};
exports.isSpeech = isSpeech;
