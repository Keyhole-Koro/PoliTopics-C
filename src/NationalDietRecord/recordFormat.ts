import { MapIssue } from '@interfaces/Record';
import { RawData, RawSpeech } from './RawRecord';

export default class SpeechFormatter {

    private cleanText(text: string): string {
        return text.replace(/\r\n/g, '\n').replace(/\u3000/g, ' ');
    }

    private formatIssueData(speeches: RawSpeech[]): MapIssue | null {
        if (!speeches.length) return null;

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

    private groupSpeechesByIssue(data: RawData): Record<string, MapIssue> {
        const speechesByIssue = new Map<string, RawSpeech[]>();

        data.speechRecord.forEach(speech => {
            const speeches = speechesByIssue.get(speech.issueID) || [];
            speeches.push(speech);
            speechesByIssue.set(speech.issueID, speeches);
        });

        const result: Record<string, MapIssue> = {};
        for (const [issueId, speeches] of speechesByIssue) {
            const formatted = this.formatIssueData(speeches);
            if (formatted) {
                result[issueId] = formatted;
            }
        }

        return result;
    }

    public mapRecords(jsonRecords: RawData): Record<string, MapIssue> {
        return this.groupSpeechesByIssue(jsonRecords);
    }

    public getStats(data: Record<string, MapIssue>) {
        return {
            totalIssues: Object.keys(data).length,
            totalSpeeches: Object.values(data)
                .reduce((sum, issue) => sum + issue.speeches.length, 0)
        };
    }
}
