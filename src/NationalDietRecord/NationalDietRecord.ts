import fetchRecords, { FetchParams } from "./NationalDietAPIHandler";
import SpeechFormatter from './recordFormat';

async function fetchNationalDietRecords(endpoint: string, params: FetchParams = {}) {
    const formatter = new SpeechFormatter();
    const result = await fetchRecords(endpoint, params);
    return formatter.mapRecords(result);
}

export default fetchNationalDietRecords;