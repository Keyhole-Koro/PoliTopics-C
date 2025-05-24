export interface RawSpeech {
    speechID: string;
    issueID: string;
    imageKind: string;
    searchObject: number;
    session: number;
    nameOfHouse: string;
    nameOfMeeting: string;
    issue: string;
    date: string;
    closing: string;
    speechOrder: number;
    speaker: string;
    speakerYomi: string;
    speakerGroup: string;
    speakerPosition: string;
    speakerRole: string;
    speech: string;
    startPage: number;
    speechURL: string;
    meetingURL: string;
    pdfURL: string;
}

export interface RawData {
    numberOfRecords: number;
    numberOfReturn: number;
    startRecord: number;
    nextRecordPosition: number | null;
    speechRecord: RawSpeech[];
}

export const transformRawSpeechToSpeech = (raw: RawSpeech): Speech => ({
    speechOrder: raw.speechOrder,
    speaker: raw.speaker,
    speakerYomi: raw.speakerYomi,
    speakerGroup: raw.speakerGroup,
    speakerPosition: raw.speakerPosition,
    speakerRole: raw.speakerRole,
    speech: raw.speech
});

export const isRawSpeech = (obj: any): obj is RawSpeech => {
    return obj &&
        typeof obj.speechID === 'string' &&
        typeof obj.issueID === 'string' &&
        typeof obj.imageKind === 'string' &&
        typeof obj.searchObject === 'number' &&
        typeof obj.session === 'number' &&
        typeof obj.date === 'string' &&
        typeof obj.speechOrder === 'number';
};
