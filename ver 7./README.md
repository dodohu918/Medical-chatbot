in project console run
    npm install firebase-admin

in base console run
    npm install -g firebase-tools
    
in project console run
    firebase login
    firebase init functions

In your functions/package.json, add the googleapis library:
    cd functions
    npm install googleapis

Then finally
    firebase deploy --only functions