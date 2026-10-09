
export const environment = {
  production: false,


  apiBaseUrl: 'http://localhost:3000/api',

  deviceApiBaseUrl: 'http://192.168.1.100:3000/api',

  geolocation: {
    rute1: 'https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252',
    rute2: 'https://www.google.com/maps?q=-6.1891005,106.8371641',
  },
};

// geofencing based on location coordinates, for example: if the user is within a certain radius of a specific location, 
// the app can trigger certain actions or notifications. This can be useful for location-based services, such as sending alerts when a user enters or leaves a designated area.
// if the user is not on the specified area for example route 1. the userr cannot submit the form. and the only route exist is the one that on his current location. for example
// if the user was on the route2 or https://www.google.com/maps?q=-6.1891005,106.8371641. he can only submit the form on that route, SJRE -> SBDZ. he cant input another route while on his current lcoation

// and if the user was on the route1 https://www.google.com/maps?q=-6.2389899548617285,106.97475839406252. the user only can input on the route1 or SBDZ ->  SJRE. 
// and cannot submit the form on the route2 or https://www.google.com/maps?q=-6.1891005,106.8371641. he can only submit the form on that route, SBDZ -> SJRE. 
// he cant input another route while on his current lcoation.
// for the maximum range is 100m. and make sure to make it strict

// for now this feature only available for region badau dermaga 1 first for the testing


