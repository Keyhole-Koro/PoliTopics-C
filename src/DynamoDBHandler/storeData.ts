import { Article } from '@interfaces/Article';

const storeData = async (article: Article) => {

    const response = await fetch('https://z14df1piv6.execute-api.ap-northeast-3.amazonaws.com/stage/articles', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(article),
    });

    return response
}

export default storeData;