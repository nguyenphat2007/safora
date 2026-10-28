/** Local compatibility rules replace the upstream presence-only Shorts discriminator.
 * The configuration boundary appends them to native userrules while retaining a separate personal
 * policy input, so this internal exception cannot disable the startup guard's user policy.
 */
const shortsAdPath = 'entries.[-].command.reelWatchEndpoint.adClientParams.isAd';
const typedShortsPaths = [shortsAdPath, `reelWatchSequenceResponse.${shortsAdPath}`]
  .flatMap(path => [`${path}.[=].true`, `${path}.[=].1`]).join(' ');

export const YOUTUBE_COMPATIBILITY_RULES = [
  `youtube.com#@%#//scriptlet('json-prune', '${shortsAdPath}')`,
  `youtube.com#%#//scriptlet('json-prune', '${typedShortsPaths}')`,
] as const;
