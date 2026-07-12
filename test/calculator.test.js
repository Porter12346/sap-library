const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseReplayForCalculator,
  generateCalculatorLink
} = require("../lib/calculator");
const { getReplayBuildModel } = require("../lib/replayPerspectives");

function deck(id, title, minions) {
  return { Id: id, Title: title, Minions: minions };
}

function board(deckRef) {
  return {
    Pack: null,
    Deck: deckRef,
    Tur: 8,
    Mins: { Items: [] },
    Rel: { Items: [] }
  };
}

test("calculator uses the opponent perspective to resolve a missing custom deck", () => {
  const playerDeck = deck("player-deck", "Player Custom", ["0"]);
  const opponentDeck = deck("opponent-deck", "Opponent Custom", ["2"]);
  const battle = {
    UserBoard: board({ Id: playerDeck.Id }),
    OpponentBoard: board({ Id: opponentDeck.Id })
  };

  const playerBuildModel = { Bor: { Deck: playerDeck } };
  const opponentBuildModel = { Bor: { Deck: opponentDeck } };
  const state = parseReplayForCalculator(
    battle,
    playerBuildModel,
    [opponentBuildModel]
  );

  assert.equal(state.playerPack, "Player Custom");
  assert.equal(state.opponentPack, "Opponent Custom");
  assert.deepEqual(
    state.customPacks.map((pack) => pack.deckId),
    ["player-deck", "opponent-deck"]
  );
});

test("GenesisBuildModel is preferred over the legacy mode model", () => {
  const buildModel = { Bor: { Deck: deck("build", "Build Pack", ["0"]) } };
  const modeModel = { Bor: { Deck: deck("mode", "Mode Pack", ["2"]) } };
  const selected = getReplayBuildModel({
    GenesisBuildModel: JSON.stringify(buildModel),
    GenesisModeModel: JSON.stringify(modeModel)
  });

  assert.equal(selected.Bor.Deck.Id, "build");
});

test("calculator preserves copied Abomination and Parrot abilities", () => {
  const battle = {
    UserBoard: board({ Id: "player-deck" }),
    OpponentBoard: {
      ...board({ Id: "opponent-deck" }),
      Mins: {
        Items: [
          { Enu: "373", Lvl: 1, Poi: { x: 0 }, At: { Perm: 6 }, Hp: { Perm: 5 }, Abil: [{ Enu: 360, Lvl: 1 }] },
          { Enu: "53", Lvl: 1, Poi: { x: 1 }, At: { Perm: 4 }, Hp: { Perm: 2 }, Abil: [{ Enu: 360, Lvl: 1 }] }
        ]
      }
    }
  };
  const state = parseReplayForCalculator(
    battle,
    null,
    [],
    {
      abilitySources: [
        { Enu: "360", Abil: [{ Enu: 360, Lvl: 1 }] }
      ]
    }
  );

  const opponentPets = state.opponentPets.filter(Boolean);
  const abomination = opponentPets.find((pet) => pet.name === "Abomination");
  const parrot = opponentPets.find((pet) => pet.name === "Parrot");
  assert.equal(abomination.abominationSwallowedPet1, "Minotaur");
  assert.equal(parrot.parrotCopyPet, "Minotaur");

  const encoded = generateCalculatorLink(state).split("?c=")[1];
  const compactState = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(compactState.o.find((pet) => pet?.n === "Abomination").aSP1, "Minotaur");
  assert.equal(compactState.o.find((pet) => pet?.n === "Parrot").pCP, "Minotaur");
});
