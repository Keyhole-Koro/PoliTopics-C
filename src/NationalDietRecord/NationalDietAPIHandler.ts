import SpeechFormatter from './recordFormat';

export interface FetchParams {
    from?: string;
    until?: string;
    [key: string]: any;
}

async function fetchRecords(endpoint: string, params: FetchParams = {}) {
    const formatter = new SpeechFormatter();

    const {
        from = '0000-01-01',  // Default start date if not specified
        until = new Date().toISOString().split('T')[0], // Default to today
        ...otherParams
    } = params;
    
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
    } catch (error) {
        console.error('Failed to fetch records:', error);
        throw error;
    }
}

export default fetchRecords;