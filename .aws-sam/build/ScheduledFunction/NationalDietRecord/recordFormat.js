"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class SpeechFormatter {
    cleanText(text) {
        return text.replace(/\r\n/g, '\n').replace(/\u3000/g, ' ');
    }
    formatIssueData(speeches) {
        if (!speeches.length)
            return null;
        const firstSpeech = speeches[0];
        return {
            imageKind: firstSpeech.imageKind,
            session: firstSpeech.session,
            nameOfHouse: firstSpeech.nameOfHouse,
            nameOfMeeting: firstSpeech.nameOfMeeting,
            date: firstSpeech.date,
            speeches: speeches
                .sort((a, b) => a.speechOrder - b.speechOrder)
                .map(s => ({
                speechOrder: s.speechOrder,
                speaker: s.speaker,
                speakerYomi: s.speakerYomi,
                speakerGroup: s.speakerGroup,
                speakerPosition: s.speakerPosition,
                speakerRole: s.speakerRole,
                speech: this.cleanText(s.speech)
            }))
        };
    }
    groupSpeechesByIssue(data) {
        const speechesByIssue = new Map();
        data.speechRecord.forEach(speech => {
            const speeches = speechesByIssue.get(speech.issueID) || [];
            speeches.push(speech);
            speechesByIssue.set(speech.issueID, speeches);
        });
        const result = {};
        for (const [issueId, speeches] of speechesByIssue) {
            const formatted = this.formatIssueData(speeches);
            if (formatted) {
                result[issueId] = formatted;
            }
        }
        return result;
    }
    mapRecords(jsonRecords) {
        return this.groupSpeechesByIssue(jsonRecords);
    }
    getStats(data) {
        return {
            totalIssues: Object.keys(data).length,
            totalSpeeches: Object.values(data)
                .reduce((sum, issue) => sum + issue.speeches.length, 0)
        };
    }
}
exports.default = SpeechFormatter;
