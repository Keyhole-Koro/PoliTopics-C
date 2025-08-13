import { RawMeetingData, RawSpeechRecord } from './RawData';

function cleanText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u3000/g, ' ');
}

export function gatherSpeechesById(data: RawMeetingData): Record<string, { meetingInfo: any; speeches: RawSpeechRecord[] }> {
  const speechMap: Record<string, { meetingInfo: any; speeches: RawSpeechRecord[] }> = {};

  for (const meeting of data.meetingRecord) {
    const { imageKind, session, issue, nameOfHouse, nameOfMeeting, closing, searchObject } = meeting;
    const meetingInfo = {
      imageKind,
      session,
      issue,
      nameOfHouse,
      nameOfMeeting,
      closing,
      searchObject,
    };

    for (const speech of meeting.speechRecord) {
      const baseId = speech.speechID.split('_')[0];
      if (!speechMap[baseId]) {
        speechMap[baseId] = { meetingInfo, speeches: [] };
      }
      speechMap[baseId].speeches.push(speech);
    }
  }

  return speechMap;
}