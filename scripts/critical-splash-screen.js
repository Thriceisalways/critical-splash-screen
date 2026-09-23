/**
 * CRIT ANIMATIONS MODULE — dnd5e + Sequencer
 *
 * Detects a natural 20 (crit) or natural 1 (fumble) on:
 *   - attack rolls
 *   - death saving throws
 *   - ability checks
 *   - skill checks
 * and displays a per-character static image as a screen-space overlay
 * (always visible regardless of vision or fog of war), optionally
 * with a sound that plays alongside it. The image is chosen by which
 * character rolled, not which user account triggered the roll (useful
 * since a GM often rolls on a player's behalf).
 *
 * Also plays a random sound from a configured folder whenever a token
 * gets the "dead" status effect, and a universal fumble sound folder
 * used as a fallback when a character has no custom fumble sound set.
 *
 * IMPORTANT: all of this logic runs on the GM's client only. Document
 * hooks (createChatMessage, updateChatMessage, createActiveEffect)
 * fire on every connected client, so without this restriction, each
 * player's client would independently pick its own random sound and
 * broadcast it, causing multiple different sounds to overlap.
 *
 * CONFIGURATION
 * Go to Game Settings > Configure Settings > Module Settings, find
 * "Critical Splash Screens", and click "Open Configuration". From there you
 * can add characters, set their crit/fumble images and sounds, the
 * death sound folder, the universal fumble sound folder, and adjust
 * the global screen scale.
 */

const MODULE_ID = "critical-splash-screen";

const DEFAULT_ANIMATION_ENTRY = {
  duration: 2000,
  fadeIn: 300,
  fadeOut: 300
};

// No seed data, add characters via the config menu after installing.
const SEED_ANIMATIONS = {};
const SEED_FUMBLE_ANIMATIONS = {};

/**
 * The settings configuration menu, opened from Module Settings.
 */
class CritAnimationsConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  constructor(options = {}) {
    super(options);

    const animations = game.settings.get(MODULE_ID, "animations");
    const fumbleAnimations = game.settings.get(MODULE_ID, "fumbleAnimations");
    const criticalThresholds = game.settings.get(MODULE_ID, "criticalThresholds");
    const actorIds = new Set([
      ...Object.keys(animations),
      ...Object.keys(fumbleAnimations),
      ...Object.keys(criticalThresholds)
    ]);

    this.rows = [...actorIds].map((id) => ({
      actorId: id,
      critFile: animations[id]?.file ?? "",
      critSound: animations[id]?.sound ?? "",
      fumbleFile: fumbleAnimations[id]?.file ?? "",
      fumbleSound: fumbleAnimations[id]?.sound ?? "",
      critThreshold: criticalThresholds[id] ?? ""
    }));
  }

  static DEFAULT_OPTIONS = {
    id: "critical-splash-screen-config",
    tag: "form",
    window: {
      title: "Critical Splash Screens Configuration",
      icon: "fas fa-image",
      resizable: true
    },
    position: {
      width: 720,
      height: 700
    },
    form: {
      handler: CritAnimationsConfig.onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addRow: CritAnimationsConfig.onAddRow,
      deleteRow: CritAnimationsConfig.onDeleteRow,
      pickImage: CritAnimationsConfig.onPickImage
    }
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/config.hbs`,
      scrollable: [""]
    }
  };

  async _prepareContext() {
    const actors = game.actors.contents
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const rows = this.rows.map((row) => ({
      ...row,
      actorOptions: [{ id: "", name: "— Select Actor —", selected: !row.actorId }].concat(
        actors.map((a) => ({ ...a, selected: a.id === row.actorId }))
      )
    }));

    return {
      rows,
      scale: game.settings.get(MODULE_ID, "screenScale"),
      defaultCrit: game.settings.get(MODULE_ID, "defaultAnimation").file,
      defaultFumble: game.settings.get(MODULE_ID, "defaultFumbleAnimation").file,
      deathSoundFolder: game.settings.get(MODULE_ID, "deathSoundFolder"),
      critSoundFolder: game.settings.get(MODULE_ID, "critSoundFolder"),
      fumbleSoundFolder: game.settings.get(MODULE_ID, "fumbleSoundFolder")
    };
  }

  static onAddRow() {
    this.rows.push({ actorId: "", critFile: "", critSound: "", fumbleFile: "", fumbleSound: "", critThreshold: "" });
    this.render();
  }

  static onDeleteRow(event, target) {
    const index = Number(target.dataset.index);
    this.rows.splice(index, 1);
    this.render();
  }

  static onPickImage(event, target) {
    const targetName = target.dataset.target;
    const pickerType = target.dataset.pickerType || "image";
    const input = this.element.querySelector(`[name="${targetName}"]`);
    const current = input?.value ?? "";

    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    new FP({
      type: pickerType,
      current,
      callback: (path) => {
        if (input) input.value = path;
      }
    }).render(true);
  }

  static async onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const scale = Number(data.scale) || 1;
    const defaultCrit = data.defaultCrit ?? "";
    const defaultFumble = data.defaultFumble ?? "";
    const deathSoundFolder = data.deathSoundFolder ?? "/sound/Dying";
    const critSoundFolder = data.critSoundFolder ?? "";
    const fumbleSoundFolder = data.fumbleSoundFolder ?? "";
    const rows = data.rows ? Object.values(data.rows) : [];

    const animations = {};
    const fumbleAnimations = {};
    const criticalThresholds = {};

    for (const row of rows) {
      if (!row.actorId) continue;
      if (row.critFile) {
        animations[row.actorId] = { file: row.critFile, ...DEFAULT_ANIMATION_ENTRY };
        if (row.critSound) animations[row.actorId].sound = row.critSound;
      }
      if (row.fumbleFile) {
        fumbleAnimations[row.actorId] = { file: row.fumbleFile, ...DEFAULT_ANIMATION_ENTRY };
        if (row.fumbleSound) fumbleAnimations[row.actorId].sound = row.fumbleSound;
      }
      const threshold = Number(row.critThreshold);
      if (row.critThreshold && Number.isInteger(threshold) && threshold >= 2 && threshold <= 20) {
        criticalThresholds[row.actorId] = threshold;
      }
    }

    await game.settings.set(MODULE_ID, "screenScale", scale);
    await game.settings.set(MODULE_ID, "animations", animations);
    await game.settings.set(MODULE_ID, "fumbleAnimations", fumbleAnimations);
    await game.settings.set(MODULE_ID, "criticalThresholds", criticalThresholds);
    await game.settings.set(MODULE_ID, "defaultAnimation", { file: defaultCrit, ...DEFAULT_ANIMATION_ENTRY });
    await game.settings.set(MODULE_ID, "defaultFumbleAnimation", { file: defaultFumble, ...DEFAULT_ANIMATION_ENTRY });
    await game.settings.set(MODULE_ID, "deathSoundFolder", deathSoundFolder);
    await game.settings.set(MODULE_ID, "critSoundFolder", critSoundFolder);
    await game.settings.set(MODULE_ID, "fumbleSoundFolder", fumbleSoundFolder);

    ui.notifications.info("Critical Splash Screens settings saved.");
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "screenScale", {
    scope: "world",
    config: false,
    type: Number,
    default: 1
  });

  game.settings.register(MODULE_ID, "animations", {
    scope: "world",
    config: false,
    type: Object,
    default: SEED_ANIMATIONS
  });

  game.settings.register(MODULE_ID, "fumbleAnimations", {
    scope: "world",
    config: false,
    type: Object,
    default: SEED_FUMBLE_ANIMATIONS
  });

  game.settings.register(MODULE_ID, "criticalThresholds", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "defaultAnimation", {
    scope: "world",
    config: false,
    type: Object,
    default: { file: "modules/critical-splash-screen/images/default-crit.png", ...DEFAULT_ANIMATION_ENTRY }
  });

  game.settings.register(MODULE_ID, "defaultFumbleAnimation", {
    scope: "world",
    config: false,
    type: Object,
    default: { file: "modules/critical-splash-screen/images/default-fumble.png", ...DEFAULT_ANIMATION_ENTRY }
  });

  game.settings.register(MODULE_ID, "deathSoundFolder", {
    scope: "world",
    config: false,
    type: String,
    default: "/sound/Dying"
  });

  game.settings.register(MODULE_ID, "critSoundFolder", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "fumbleSoundFolder", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.registerMenu(MODULE_ID, "configMenu", {
    name: "Critical Splash Screens",
    label: "Open Configuration",
    hint: "Add characters, set crit/fumble images and sounds, death sound folder, fumble sound folder, and adjust the global screen scale.",
    icon: "fas fa-image",
    type: CritAnimationsConfig,
    restricted: true
  });
});

// dnd5e v14 splits roll type info across two different flag locations
// depending on the roll: attacks go through the activity system, while
// skill checks, ability checks and death saves use flags.dnd5e.roll.type
const ELIGIBLE_ROLL_TYPES = ["attack", "skill", "ability", "death"];

function getRollType(message) {
  if (message.flags?.dnd5e?.activity?.type === "attack") return "attack";
  return message.flags?.dnd5e?.roll?.type ?? null;
}

function isNaturalTwenty(roll) {
  if (!roll?.dice?.length) return false;
  const d20 = roll.dice.find((d) => d.faces === 20);
  if (!d20) return false;
  // Handles advantage/disadvantage: only the "active" (counted) die matters
  return d20.results.some((r) => r.active && r.result === 20);
}

function isNaturalOne(roll) {
  if (!roll?.dice?.length) return false;
  const d20 = roll.dice.find((d) => d.faces === 20);
  if (!d20) return false;
  return d20.results.some((r) => r.active && r.result === 1);
}

function isNaturalAtLeast(roll, threshold) {
  if (!roll?.dice?.length) return false;
  const d20 = roll.dice.find((d) => d.faces === 20);
  if (!d20) return false;
  return d20.results.some((r) => r.active && r.result >= threshold);
}

async function pickRandomFileFromFolder(folderPath) {
  if (!folderPath) return null;
  try {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const folder = await FP.browse("data", folderPath);
    if (!folder.files.length) return null;
    return folder.files[Math.floor(Math.random() * folder.files.length)];
  } catch (err) {
    console.warn(`Critical Splash Screens: could not browse folder "${folderPath}".`, err);
    return null;
  }
}

Hooks.once("ready", () => {
  const handledMessageIds = new Set();

  async function handleMessage(message) {
    // Only the GM's client runs this. createChatMessage/updateChatMessage
    // fire on every connected client, and Sequencer's .play() already
    // broadcasts to everyone from a single call, so running this on
    // every client would multiply effects/sounds.
    if (!game.user.isGM) return;

    if (handledMessageIds.has(message.id)) return;

    const rollType = getRollType(message);
    if (!ELIGIBLE_ROLL_TYPES.includes(rollType)) return;

    const roll = message.rolls?.[0];
    if (!roll) return;

    const actor = message.speaker?.actor
      ? game.actors.get(message.speaker.actor)
      : (message.author ?? game.users.get(message.user))?.character;
    if (!actor) {
      console.warn("Critical Splash Screens: could not resolve an actor for this roll.");
      return;
    }

    // Crit threshold priority: manual override from the config menu, then
    // the actual dnd5e flag a feature like Improved Critical sets on the
    // actor (flags.dnd5e.weaponCriticalThreshold), then plain nat 20.
    const criticalThresholds = game.settings.get(MODULE_ID, "criticalThresholds");
    const manualThreshold = criticalThresholds[actor.id];
    const flagThreshold = actor.flags?.dnd5e?.weaponCriticalThreshold;
    const effectiveThreshold =
      manualThreshold ?? (typeof flagThreshold === "number" && flagThreshold < 20 ? flagThreshold : null);

    const isCrit = effectiveThreshold
      ? isNaturalAtLeast(roll, effectiveThreshold)
      : (roll.isCritical ?? isNaturalTwenty(roll));
    const isFumble = roll.isFumble ?? isNaturalOne(roll);
    if (!isCrit && !isFumble) return;

    // Mark as handled now that we have a roll and know its outcome,
    // so a later updateChatMessage for the same message doesn't fire twice
    handledMessageIds.add(message.id);

    const animations = game.settings.get(MODULE_ID, isCrit ? "animations" : "fumbleAnimations");
    const fallback = game.settings.get(MODULE_ID, isCrit ? "defaultAnimation" : "defaultFumbleAnimation");
    const anim = animations[actor.id] ?? fallback;
    const scale = game.settings.get(MODULE_ID, "screenScale");

    // Custom sound takes priority. If there's no custom sound set, fall
    // back to a random pick from the universal crit/fumble sound folder.
    // This runs regardless of whether an image is set, so a character
    // with no custom image (falling back to the default splash) still
    // gets a sound.
    let soundFile = anim?.sound ?? null;
    if (!soundFile) {
      const folderSetting = isCrit ? "critSoundFolder" : "fumbleSoundFolder";
      const soundFolder = game.settings.get(MODULE_ID, folderSetting);
      soundFile = await pickRandomFileFromFolder(soundFolder);
    }

    // Nothing to show and nothing to play, genuinely nothing to do.
    if (!anim?.file && !soundFile) return;

    const sequence = new Sequence();

    if (anim?.file) {
      sequence
        .effect()
        .file(anim.file)
        .screenSpace()
        .screenSpaceAnchor({ x: 0.5, y: 0.5 })
        .screenSpaceScale({ x: scale, y: scale, fitX: true, fitY: true })
        .duration(anim.duration ?? 2000)
        .fadeIn(anim.fadeIn ?? 300)
        .fadeOut(anim.fadeOut ?? 300);
    }

    if (soundFile) {
      sequence.sound().file(soundFile).volume(0.8);
    }

    sequence.play();
  }

  Hooks.on("createChatMessage", handleMessage);
  Hooks.on("updateChatMessage", handleMessage);

  Hooks.on("createActiveEffect", async (effect) => {
    // Same reasoning as above: GM client only, or every connected
    // player's client would each pick and broadcast their own
    // random death sound.
    if (!game.user.isGM) return;
    if (!effect.statuses?.has("dead")) return;

    const folderPath = game.settings.get(MODULE_ID, "deathSoundFolder");
    const chosen = await pickRandomFileFromFolder(folderPath);
    if (!chosen) return;

    const AH = foundry.audio?.AudioHelper ?? AudioHelper;
    AH.play({ src: chosen, volume: 0.8, autoplay: true, loop: false }, true);
  });

  console.log("Critical Splash Screens | Ready, listening for natural 20s and 1s.");
});
