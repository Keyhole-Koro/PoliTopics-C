import { jest } from '@jest/globals';
import storeData from './storeData';
import { Article } from '@interfaces/Article';
import summarySample from './summarySample.json';

describe.only('storeData', () => {
    const mockArticles: Article[] = summarySample as unknown as Article[];

    it('should send a POST request with the correct payload', async () => {
        mockArticles.forEach(async article => {
            const response = await storeData(article);
            console.log('Response:', response);
        });
    });
/*
    it('should handle a successful response', async () => {
        (fetch as jest.Mock).mockResolvedValue(new Response(null, { status: 200 }));

        await expect(storeData(mockArticles)).resolves.not.toThrow();
    });

    it('should handle a failed response', async () => {
        (fetch as jest.Mock).mockResolvedValue(new Response(null, { status: 500 }));

        await expect(storeData(mockArticles)).rejects.toThrow('Failed to store data');
    });

    it('should throw an error if fetch fails', async () => {
        (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

        await expect(storeData(mockArticles)).rejects.toThrow('Network error');
        
    });
    */
});