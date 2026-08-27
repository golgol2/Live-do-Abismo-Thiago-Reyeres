function reverseInPlace(str) {
    const words = str.match(/\S+/g) || [];
    return words.map(word => word.split('').reverse().join('')).join(' ');
}

const getFixQuery = query => {
    return Object.keys(query).reduce((acc, key) => {
        acc[key] = query[key].replace('/', '');
        return acc;
    }, {});
};

const getSegment = str => {
    try {
        const match = str.match(/\/([^\/]+(?=\.ts))/);
        return match ? match[1] : false;
    } catch (err) {
        return false;
    }
};

module.exports = { reverseInPlace, getFixQuery, getSegment };
