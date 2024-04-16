const express = require('express');
const bodyParser = require('body-parser')
const axios = require('axios');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;

require("dotenv").config();

const app = express();
const port = process.env.PORT || 8080;
const apiKeyOpenWeather = `${process.env.API_KEY_OPENWEATHER}`;
const DBUrl = process.env.DB_CONNECTION;
const DBName = process.env.DB_NAME;
const mongoClient = new MongoClient(DBUrl);

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(express.static(__dirname + '/assets'));

app.set("view engine", "ejs");
app.set('views', path.join(__dirname, 'views'));

//Pagina d'avvio
app.get("/", function (req, res) {
    res.render("meteo", { weather: null, error: null });
});

//Pagina che risponderà a chiamata /index
app.get("/index", function (req, res) {
    res.render("meteo", { weather: null, error: null });
});

//Quando richiesto l'elenco delle città
app.get('/elenco', async function (req, res) {

    let jsonOutput = {
        "cities": []
    };

    //acquisisco tutti i dati del database
    const list = await getList("cities_list");

    //inserisco il risultato nell'array JSON(output) cities
    jsonOutput.cities = list;

    // render output view
    res.render('elenco', jsonOutput);
    res.end();

});

//visualizzo il meteo della città alle coordinate acquisite dalla geolocalizzazione del browser in POST
app.post('/city', async function (req, res) {

    const latitude = parseFloat(req.body.latitude);
    const longitude = parseFloat(req.body.longitude);

    let jsonOutput = {
        "weather": null,
        "place": null,
        "coordinates": null,
        "weatherDays": [],
        "error": null,
    };

    const [placeInfo, forecastInfo] = await Promise
        .all(
            [
                getPlaceInfo(`https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKeyOpenWeather}`),
                getForecastCity(`https://api.openweathermap.org/data/2.5/onecall?lat=${latitude}&lon=${longitude}&exclude=minutely,hourly&appid=${apiKeyOpenWeather}`, latitude, longitude)
            ])
        .catch((error) => {
            console.log(error);
            res.render('city', { weather: null, error: "Errore" });
            res.end();
        });

    jsonOutput.weather = placeInfo;
    jsonOutput.place = `${placeInfo.name}, ${placeInfo.sys.country}`;
    jsonOutput.coordinates = `${placeInfo.coord.lat} lat, ${placeInfo.coord.lon} lon`;
    jsonOutput.weatherDays = forecastInfo;

    //creo l'oggetto da aggiungere al database delle coordinate
    let city_coords = {
        city_name: `${placeInfo.name}, ${placeInfo.sys.country}`,
        latitude: placeInfo.coord.lat,
        longitude: placeInfo.coord.lon
    };

    //aggiorno il database con i dati, se il dato non esiste viene aggiunto
    UpdateList("cities_list", city_coords).catch(() => { console.error("Error on insert") });

    // render output view
    res.render('city', jsonOutput);
    res.end();

});

app.listen(port);
console.log('Server started at http://localhost:' + port);


//acquisisco le informazioni della citta dall'API (uso nome e stato)
getPlaceInfo = async (cityUrl) => {

    try {
        const response = await axios.get(cityUrl)
        const result = response.data;
        if (result.main == undefined) {
            return Promise.reject();
        }

        return Promise.resolve(result);
    } catch (error) {
        return Promise.reject(error);
    }

}

//acquisisco le previsioni meteo della città
getForecastCity = async (forecastUrl, latitude, longitude) => {

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    try {
        let output = [];
        const response = await axios.get(forecastUrl)
        const result = response.data;
        if (result.daily == undefined) {
            return Promise.reject(error);
        }

        result.daily.forEach(element => {

            let outputObject = {
                temp: Math.round(`${element.temp.day}` - 273.15),
                description: element.weather[0].description,
                time: `${new Date(element.dt * 1000).toLocaleDateString('it-IT', options)}`,
                icon: `http://openweathermap.org/img/wn/${element.weather[0].icon}@2x.png`,
                humidity: element.humidity,
                clouds: element.clouds,
                visibility: element.visibility,
                pressure: element.pressure,
                longitude: longitude,
                latitude: latitude,
                temp_min:  Math.round(`${element.temp.min}` - 273.15),
                temp_max:  Math.round(`${element.temp.max}` - 273.15),
                _id: element.dt,
            };

            // push to output 
            output.push(outputObject);
        });

        return Promise.resolve(output);
    } catch (error) {
        return Promise.reject(error);
    }
}

//Funzione che aggiorna il database delle coordinate
UpdateList = async (collectionName, elementToInsert) => {

    try {
        await mongoClient.connect();
        const database = mongoClient.db(DBName);
        const cities = database.collection(collectionName);
        let result = await cities.updateMany(
            { city_name: elementToInsert.city_name},
            { $set: elementToInsert },
            { upsert: true });
        return Promise.resolve(result);
    } catch (error) {
        return Promise.reject();
    }
}

//Funzione che acquisisce tutti i dati di una collection (usata solo per acquisire la lista)
getList = async (collectionName) => {
    try {
        await mongoClient.connect();
        const database = mongoClient.db(DBName);
        const cities = database.collection(collectionName);
        let result = await cities.find({}).sort({"city_name": 1}).toArray();
        return Promise.resolve(result);
    } catch (error) {
        return Promise.resolve([]);
    }
}