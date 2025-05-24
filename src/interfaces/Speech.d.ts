export interface Speech {
    speechOrder: number;
    speaker: string;
    speakerYomi: string;
    speakerGroup: string;
    speakerPosition: string;
    speakerRole: string;
    speech: string;
}

export interface MapIssue {
    imageKind: string;
    session: number;
    nameOfHouse: string;
    nameOfMeeting: string;
    date: string;
    speeches: Speech[];
}



export const createProcessedIssue = (raw: RawSpeech, speeches: Speech[]): ProcessedIssue => ({
    imageKind: raw.imageKind,
    session: raw.session,
    nameOfHouse: raw.nameOfHouse,
    nameOfMeeting: raw.nameOfMeeting,
    date: raw.date,
    speeches: speeches
});

// Type guards for runtime type checking
export const isSpeech = (obj: any): obj is Speech => {
    return obj &&
        typeof obj.speechOrder === 'number' &&
        typeof obj.speaker === 'string' &&
        typeof obj.speakerYomi === 'string' &&
        typeof obj.speakerGroup === 'string' &&
        typeof obj.speakerPosition === 'string' &&
        typeof obj.speakerRole === 'string' &&
        typeof obj.speech === 'string';
};
