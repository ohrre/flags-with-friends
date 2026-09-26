import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAlxzI0QEUFeus-moYxcBHVdrEys29BL9E",
    authDomain: "flags-with-friends-e6ceb.firebaseapp.com",
    projectId: "flags-with-friends-e6ceb",
    storageBucket: "flags-with-friends-e6ceb.firebasestorage.app",
    messagingSenderId: "207834095918",
    appId: "1:207834095918:web:0962a3e9bf1d21f5815abf",
    databaseURL: "https://flags-with-friends-e6ceb-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let countriesData = [];
let playerId = 'player_' + Math.random().toString(36).substring(2, 9);
let playerName = '';
let currentRoomId = null;
let isHost = false;
let myScore = 0;
let timerInterval = null;
let currentAssignedTarget = null;
let currentPartnerId = null;
let hasInitializedGameScreen = false;
let allPlayersData = {};

const screens = {
    lobby: document.getElementById('lobby-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen')
};

function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[screenName]) {
        screens[screenName].classList.add('active');
    }
}

function showLobbyError(message) {
    const errorEl = document.getElementById('lobby-error');
    if (errorEl) {
        errorEl.innerText = message;
        errorEl.style.display = 'block';
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 4000);
    }
}

async function loadCountries() {
    try {
        const response = await fetch('countries.json');
        const rawData = await response.json();
        
        // Filter UN full members OR explicitly include Palestine ("PS") and Vatican City ("VA")
        countriesData = rawData.filter(c => c.unMember === true || c.cca2 === "PS" || c.cca2 === "VA");

        console.log(`%c Total Countries Loaded (Including Observer States): ${countriesData.length} `, 'background: #222; color: #bada55; padding: 4px; font-weight: bold;');
        console.table(countriesData.map(c => ({
            Name: c.name.common || c.name,
            Code: c.cca2
        })));

        window.countriesData = countriesData;

    } catch (error) {
        console.error("Failed to load countries.json:", error);
    }
}

loadCountries();

// Fisher-Yates Shuffle to guarantee truly random, unbiased distribution
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function fnGetCountryData(c) {
    if (!c) return { name: "Unknown", code: "us" };
    let countryName = "Unknown";
    if (typeof c.name === 'object' && c.name !== null) {
        countryName = c.name.common || c.name.official || "Unknown";
    } else if (typeof c.name === 'string') {
        countryName = c.name;
    }
    let countryCode = c.cca2 || c.code || c.iso || "us";
    return {
        name: countryName,
        code: countryCode.toString().trim()
    };
}

document.getElementById('create-room-btn').addEventListener('click', () => {
    playerName = document.getElementById('player-name').value.trim();
    if (!playerName) {
        return showLobbyError("Please enter your nickname!");
    }

    currentRoomId = Math.floor(100000 + Math.random() * 900000).toString();
    isHost = true;

    const roomRef = ref(db, `rooms/${currentRoomId}`);
    set(roomRef, {
        host: playerId,
        status: 'waiting',
        players: {
            [playerId]: { name: playerName, score: 0, collectedFlags: [] }
        }
    }).then(() => {
        enterWaitingRoom();
    });
});

document.getElementById('join-room-btn').addEventListener('click', async () => {
    playerName = document.getElementById('player-name').value.trim();
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
    
    if (!playerName || !roomCode) {
        return showLobbyError("Please enter both your nickname and room code!");
    }

    const roomRef = ref(db, `rooms/${roomCode}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
        return showLobbyError("Room does not exist! Please check the code.");
    }

    currentRoomId = roomCode;
    isHost = false;

    update(ref(db, `rooms/${roomCode}/players/${playerId}`), {
        name: playerName,
        score: 0,
        collectedFlags: []
    }).then(() => {
        enterWaitingRoom();
    });
});

function enterWaitingRoom() {
    document.getElementById('display-room-code').innerText = currentRoomId;
    switchScreen('waiting');

    if (isHost) {
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('waiting-message').style.display = 'none';
        document.getElementById('start-game-btn').innerText = "Start Game";
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('waiting-message').style.display = 'block';
        document.getElementById('waiting-message').innerText = "Waiting for host to start the game...";
    }

    const roomRef = ref(db, `rooms/${currentRoomId}`);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const playerListEl = document.getElementById('player-list');
        playerListEl.innerHTML = '';
        if (data.players) {
            Object.values(data.players).forEach(p => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${p.name}</span>`;
                playerListEl.appendChild(li);
            });
        }

        if (data.status === 'playing') {
            startGamePlay(data);
        } else if (data.status === 'gameover') {
            showGameOver(data);
        }
    });
}

document.getElementById('start-game-btn').addEventListener('click', () => {
    if (!countriesData || countriesData.length === 0) {
        const waitingErr = document.getElementById('waiting-error');
        if (waitingErr) {
            waitingErr.innerText = "Countries are still loading, please wait a second.";
            waitingErr.style.display = 'block';
            setTimeout(() => { waitingErr.style.display = 'none'; }, 3000);
        }
        return;
    }

    const roomRef = ref(db, `rooms/${currentRoomId}`);
    get(roomRef).then((snapshot) => {
        const roomData = snapshot.val();
        if (!roomData || !roomData.players) return;
        
        const playerIds = Object.keys(roomData.players);
        let updates = { status: 'playing', startTime: Date.now() };

        playerIds.forEach((pid) => {
            const playerDeck = shuffleArray(countriesData);
            const initialCountry = fnGetCountryData(playerDeck[0]);
            
            updates[`players/${pid}/countryDeck`] = playerDeck.map(c => fnGetCountryData(c));
            updates[`players/${pid}/deckIndex`] = 0;
            updates[`players/${pid}/targetCountry`] = {
                name: initialCountry.name,
                code: initialCountry.code.toLowerCase()
            };
            updates[`players/${pid}/score`] = 0;
            updates[`players/${pid}/collectedFlags`] = [];
        });

        update(ref(db, `rooms/${currentRoomId}`), updates);
    });
});

function startGamePlay(roomData) {
    allPlayersData = roomData.players || {};

    if (!hasInitializedGameScreen) {
        switchScreen('game');
        document.getElementById('winner-modal').classList.remove('active');
        document.getElementById('feedback-msg').innerText = '';
        
        const playerIds = Object.keys(allPlayersData);
        const myIndex = playerIds.indexOf(playerId);
        currentPartnerId = playerIds[(myIndex + 1) % playerIds.length] || playerId;
        const partner = allPlayersData[currentPartnerId];
        const partnerName = partner ? partner.name : "Partner";

        document.getElementById('partner-header').innerText = `${partnerName}'s Flag to Describe:`;
        document.getElementById('guess-prompt').innerText = `Guess your secret country based on ${partnerName}'s clues.`;

        startRunningTimer(roomData.startTime || Date.now());

        hasInitializedGameScreen = true;
    }

    const me = allPlayersData[playerId];
    if (me) {
        if (me.score !== undefined) {
            myScore = me.score;
        }
        if (me.targetCountry) {
            currentAssignedTarget = {
                name: me.targetCountry.name,
                code: me.targetCountry.code
            };
        }
        renderCollectedFlags(me.collectedFlags || []);
    }

    const livePartner = allPlayersData[currentPartnerId];
    if (livePartner && livePartner.targetCountry) {
        document.getElementById('partner-country-name').innerText = livePartner.targetCountry.name;
        document.getElementById('partner-flag-image').src = `https://flagcdn.com/w640/${livePartner.targetCountry.code}.png`;
    }

    updateTopHeaderScores(allPlayersData);

    const roomRef = ref(db, `rooms/${currentRoomId}`);
    onValue(roomRef, (snapshot) => {
        const updatedData = snapshot.val();
        if (!updatedData || !updatedData.players) return;

        allPlayersData = updatedData.players;
        updateTopHeaderScores(allPlayersData);

        const liveMe = allPlayersData[playerId];
        if (liveMe) {
            if (liveMe.score !== undefined) {
                myScore = liveMe.score;
            }
            if (liveMe.targetCountry) {
                currentAssignedTarget = {
                    name: liveMe.targetCountry.name,
                    code: liveMe.targetCountry.code
                };
            }
            if (liveMe.collectedFlags) {
                renderCollectedFlags(liveMe.collectedFlags);
            }
        }

        const partnerSnapshot = allPlayersData[currentPartnerId];
        if (partnerSnapshot && partnerSnapshot.targetCountry) {
            document.getElementById('partner-country-name').innerText = partnerSnapshot.targetCountry.name;
            document.getElementById('partner-flag-image').src = `https://flagcdn.com/w640/${partnerSnapshot.targetCountry.code}.png`;
        }
    }, { onlyOnce: true });
}

function updateTopHeaderScores(players) {
    const scoreElement = document.getElementById('current-score');
    const playerIds = Object.keys(players);
    
    const displayParts = playerIds.map(pid => {
        const p = players[pid];
        const label = pid === playerId ? "Your" : (p.name || "Partner");
        const pts = p.score || 0;
        return `${label}: ${pts} pts`;
    });

    scoreElement.innerText = displayParts.join(' // ');
}

function renderCollectedFlags(flagsArray) {
    const gridEl = document.getElementById('collected-flags-grid');
    gridEl.innerHTML = '';
    flagsArray.forEach(flagCode => {
        const miniImg = document.createElement('img');
        miniImg.src = `https://flagcdn.com/w80/${flagCode}.png`;
        miniImg.className = 'mini-flag-badge';
        gridEl.appendChild(miniImg);
    });
    document.getElementById('collection-count').innerText = flagsArray.length;
}

function startRunningTimer(startTimeMs) {
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTimeMs) / 1000);
        let minutes = Math.floor(elapsedSeconds / 60);
        let seconds = elapsedSeconds % 60;

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        document.getElementById('game-timer').innerText = `${minutes}:${seconds}`;
    }, 1000);
}

document.getElementById('submit-guess-btn').addEventListener('click', () => {
    submitGuess();
});

document.getElementById('guess-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitGuess();
});

function isUserGuessCorrect(userGuess, targetName) {
    // Helper to normalize strings (lowercase, remove spaces, remove punctuation/accents)
    const normalize = str => str
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Strips accents (e.g., é -> e)
        .replace(/[^a-z0-9]/g, '');

    const cleanUser = normalize(userGuess);
    const cleanTarget = normalize(targetName);

    // Instant return if they are an exact match
    if (cleanUser === cleanTarget) return true;

    // Comprehensive multi-synonym groups
    const synonymGroups = [
        // Americas
        ["us", "usa", "unitedstates", "unitedstatesofamerica", "america"],
        ["bahamas", "thebahamas"],
        ["stkitts", "saintkitts", "saintkittsnevis", "stkittsnevis", "saintkittsandinnevis"],
        ["stlucia", "saintlucia"],
        ["stvincent", "saintvincent", "saintvincentandthegrenadines", "thegrenadines"],
        ["trinidad", "tobago", "trinidadandtobago"],

        // Europe
        ["uk", "unitedkingdom", "greatbritain", "britain", "england", "scotland", "wales", "northernireland"],
        ["netherlands", "holland"],
        ["czechia", "czechrepublic"],
        ["vaticancity", "vatican", "holysee"],
        ["turkey", "turkiye", "republicofturkiye"],

        // Asia & Middle East
        ["uae", "unitedarabemirates", "emirates"],
        ["southkorea", "koreasouth", "republicofkorea", "rok", "korea"],
        ["northkorea", "koreanorth", "democraticpeoplesrepublicofkorea", "dprk"],
        ["taiwan", "republicofchina", "roc"],
        ["china", "peoplesrepublicofchina", "prc"],
        ["russia", "russianfederation"],
        ["syria", "syrianarabrepublic"],
        ["laos", "laopeoplesdemocraticrepublic"],
        ["myanmar", "burma"],
        ["easttimor", "timorleste"],
        ["brunei", "bruneidarussalam"],
        ["palestine", "stateofpalestine", "palestinianterritories"],
        
        // Africa
        ["drc", "democraticrepublicofthecongo", "congodr", "democraticrepubliccongo", "congo-kinshasa"],
        ["congo", "republicofthecongo", "congobrazzaville"],
        ["car", "centralafricanrepublic"],
        ["ivorycoast", "cotedivoire", "republicofcotedivoire"],
        ["saotome", "saotomeandprincipe"],
        ["eswatini", "swaziland"],
        ["caboverde", "capeverde"],

        // Oceania
        ["micronesia", "federatedstatesofmicronesia", "fsm"],
        ["marshallislands", "themarshallislands"],
        ["solomonislands", "thesolomonislands"]
    ];

    // Check if both clean user guess and clean target live in the same array
    return synonymGroups.some(group => 
        group.includes(cleanUser) && group.includes(cleanTarget)
    );
}

async function submitGuess() {
    const inputEl = document.getElementById('guess-input');
    const userGuessText = inputEl.value.trim();
    const feedbackEl = document.getElementById('feedback-msg');

    if (!userGuessText || !currentAssignedTarget) return;

    if (isUserGuessCorrect(userGuessText, currentAssignedTarget.name)) {
        const solvedCode = currentAssignedTarget.code;
        myScore += 1;
        
        inputEl.value = '';

        feedbackEl.style.color = '#34d399';
        feedbackEl.innerText = 'Correct! Point awarded! 🎉';

        document.getElementById('mystery-placeholder').style.display = 'none';
        const guessedImg = document.getElementById('guessed-flag-image');
        guessedImg.src = `https://flagcdn.com/w640/${solvedCode}.png`;
        guessedImg.style.display = 'block';

        const playerRef = ref(db, `rooms/${currentRoomId}/players/${playerId}`);
        const snap = await get(playerRef);
        if (!snap.exists()) return;
        
        let playerData = snap.val();
        let existingFlags = playerData.collectedFlags || [];
        existingFlags.push(solvedCode);

        let nextIndex = (playerData.deckIndex || 0) + 1;
        let deck = playerData.countryDeck || [];
        
        if (nextIndex >= deck.length) {
            deck = shuffleArray(deck);
            nextIndex = 0;
        }

        const nextCountryData = deck[nextIndex];

        await update(playerRef, {
            score: myScore,
            collectedFlags: existingFlags,
            deckIndex: nextIndex,
            countryDeck: deck,
            targetCountry: {
                name: nextCountryData.name,
                code: nextCountryData.code.toLowerCase()
            }
        });

        if (myScore >= 10) {
            update(ref(db, `rooms/${currentRoomId}`), { status: 'gameover' });
            return;
        }

        currentAssignedTarget = {
            name: nextCountryData.name,
            code: nextCountryData.code.toLowerCase()
        };

        setTimeout(() => {
            feedbackEl.innerText = '';
            document.getElementById('mystery-placeholder').style.display = 'block';
            guessedImg.style.display = 'none';
            guessedImg.src = '';
        }, 1200);
    } else {
        feedbackEl.style.color = '#ef4444';
        feedbackEl.innerText = 'Incorrect, try again!';
    }
}

document.getElementById('skip-partner-flag-btn').addEventListener('click', async () => {
    const feedbackEl = document.getElementById('feedback-msg');
    feedbackEl.style.color = '#f59e0b';
    feedbackEl.innerText = 'Skipped this flag view!';
    
    const partnerRef = ref(db, `rooms/${currentRoomId}/players/${currentPartnerId}`);
    const snap = await get(partnerRef);
    if (snap.exists()) {
        let pData = snap.val();
        let nextIndex = (pData.deckIndex || 0) + 1;
        let deck = pData.countryDeck || [];
        
        if (nextIndex >= deck.length) {
            deck = shuffleArray(deck);
            nextIndex = 0;
        }
        
        const nextCountryData = deck[nextIndex];

        await update(partnerRef, {
            deckIndex: nextIndex,
            countryDeck: deck,
            targetCountry: {
                name: nextCountryData.name,
                code: nextCountryData.code.toLowerCase()
            }
        });
    }

    setTimeout(() => { feedbackEl.innerText = ''; }, 1500);
});

document.getElementById('give-up-game-btn').addEventListener('click', () => {
    if (confirm("Are you sure you want to give up and end the game?")) {
        update(ref(db, `rooms/${currentRoomId}`), { status: 'gameover' });
    }
});

document.getElementById('exit-game-btn')?.addEventListener('click', () => {
    if (confirm("Are you sure you want to exit the game completely?")) {
        if (timerInterval) clearInterval(timerInterval);

        currentRoomId = null;
        isHost = false;
        myScore = 0;
        currentAssignedTarget = null;
        currentPartnerId = null;
        hasInitializedGameScreen = false;
        allPlayersData = {};

        document.getElementById('winner-modal').classList.remove('active');
        switchScreen('lobby');
    }
});

function showGameOver(roomData) {
    if (timerInterval) clearInterval(timerInterval);
    
    switchScreen('waiting');
    hasInitializedGameScreen = false;

    const playersArray = Object.values(roomData.players || {});
    playersArray.sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = playersArray[0];

    document.getElementById('winner-announcement').innerText = winner ? `🎉 Winner: ${winner.name} (${winner.score || 0} pts)` : "It's a Tie!";

    const finalScoreboard = document.getElementById('final-scoreboard');
    finalScoreboard.innerHTML = '';

    playersArray.forEach((p, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>#${index + 1} ${p.name}</span> <span>${p.score || 0} pts</span>`;
        finalScoreboard.appendChild(li);
    });

    document.getElementById('winner-modal').classList.add('active');

    if (isHost) {
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('waiting-message').style.display = 'none';
        document.getElementById('start-game-btn').innerText = "Play Again";
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('waiting-message').style.display = 'block';
        document.getElementById('waiting-message').innerText = "Waiting for host to start a new game...";
    }
}

document.getElementById('restart-btn').addEventListener('click', () => {
    document.getElementById('winner-modal').classList.remove('active');
    
    if (isHost && currentRoomId) {
        const roomRef = ref(db, `rooms/${currentRoomId}`);
        get(roomRef).then((snapshot) => {
            const roomData = snapshot.val();
            if (!roomData || !roomData.players) return;

            const playerIds = Object.keys(roomData.players);
            let updates = { status: 'waiting' };

            playerIds.forEach(pid => {
                updates[`players/${pid}/score`] = 0;
                updates[`players/${pid}/collectedFlags`] = [];
                updates[`players/${pid}/targetCountry`] = null;
                updates[`players/${pid}/countryDeck`] = null;
                updates[`players/${pid}/deckIndex`] = 0;
            });

            update(roomRef, updates);
        });
    }
});