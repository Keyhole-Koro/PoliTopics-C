import fetchRecords, { FetchParams } from "./NationalDietAPIHandler";
import { RawMeetingData } from './RawData';

async function fetchNationalDietRecords(
    endpoint: string, params: FetchParams = {}
): Promise<RawMeetingData> {
    return await fetchRecords(endpoint, params);
}

export default fetchNationalDietRecords;