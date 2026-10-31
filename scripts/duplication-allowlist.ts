// SPDX-License-Identifier: AGPL-3.0-only
// Clones of at least 50 tokens that this change does not extract.
// The comment above a group is the reason those clones stay.
// check:lean fails when a clone is missing here, when an entry matches nothing,
// and when total duplication rises above 3%.

export interface AllowedClone {
  hash: string
  files: string
}

export const allowedClones: AllowedClone[] = [
  // The Tauri error page is a standalone document and cannot import the web design-system stylesheet. The light tokens are copied so the page still renders when the sidecar fails.
  { hash: '3bbb5870bce03dc9312e8ccbb10b69d1605d1131007fd8909bd35818d775c4c7', files: 'packages/web/src/styles.css | src-tauri/shell/style.css' },

  // The server CSV parser keeps the header row and then drops empty data rows. packages/core parseCsv drops empty rows before it reads the header. One function would change import behaviour.
  { hash: '939477773ceccc3147c2c563a9b09b8704dc90013456d1bb015c867db67024e2', files: 'packages/core/src/csv.ts | packages/server/src/service.ts' },
  { hash: '19a00ff8a8e8fa3b05aaaa5fa682e175b306ff94b6026f376caca56981ea8464', files: 'packages/core/src/csv.ts | packages/server/src/service.ts' },

  // Internal duplication in the race service. The module is far over the size limit, so splitting it is a follow-up.
  { hash: '4218e4b5b91d43ca747183a834f27c3afa8cbcc093e76084fb67947d906d507c', files: 'packages/server/src/service.ts | packages/server/src/service.ts' },
  { hash: 'eee20c2b6f0ec8b64ff5817e88c1126d2bacddc9a544599de19e3493e0edf608', files: 'packages/server/src/service.ts | packages/server/src/service.ts' },

  // Storage migrations and backup pruning share structure on purpose. Folding them together can change a shipped migration or which files are deleted, and these files are over the line limit.
  { hash: 'b2013b43c3490f23fa5819059d1fd73a52cfc6429f76f11a05bb01fac580bcb1', files: 'packages/storage/src/db.ts | packages/storage/src/schema.ts' },
  { hash: '7b4a1f04117411e1f0dcd14fbcf278d0d64aede4ecbbbd519fbc959402c00e49', files: 'packages/storage/src/db.ts | packages/storage/src/db.ts' },
  { hash: 'f155838fd8594a8c0e086bb407b69126a828c16081d1fe7ed33c5758e38d9c09', files: 'packages/storage/src/plaintext.ts | packages/storage/src/plaintext.ts' },
  { hash: 'a4f57836694bff353f862e51a5d5cde31a2cc618fca9eb6adfa9afe601e76aba', files: 'packages/storage/src/schema.ts | packages/storage/src/schema.ts' },

  // Repeated view markup. Shared UI belongs in the design system (issue 165), and this file is over the size limit.
  { hash: '91212ad50621ba0d9646214025076a0d1224b005b4038734c1402078d821c593', files: 'packages/web/src/views.tsx | packages/web/src/views.tsx' },

  // Repeated release-asset classification in a file that is already over the size limit.
  { hash: 'aacefb9d0b14ed81ba6655626ba358e3a4b3dfb334cfc8de3e65913082777464', files: 'scripts/release-assets.ts | scripts/release-assets.ts' },

  // The Windows and Unix sidecar environment tests assert different key sets. The shared lines are the assertion scaffold, not a second copy of production logic.
  { hash: '443b2ed121ca6c04b960cc59735c10a3351a91b30316231f7beb8b561ad79221', files: 'src-tauri/src/lib.rs | src-tauri/src/lib.rs' },

  // e2e/unreachable.spec.ts copies violations and smallTargets from e2e/a11y.ts. Switching the spec over is behavior-preserving, but the spec is already over the 60-line function limit.
  { hash: '537a34491f510ac01f225356d079969a7a2eb426486b251129e3a29fbfe9e5ba', files: 'e2e/a11y.ts | e2e/unreachable.spec.ts' },
  { hash: '4bc4b269b7af914b6804ece8b12465c43250dbb9d50c5d8ba6bf4400f3b79bc4', files: 'e2e/a11y.ts | e2e/unreachable.spec.ts' },

  // Repeated test setup. These files are already over the ESLint size limits, so a shared fixture waits for the complexity follow-up instead of turning those warnings into errors.
  { hash: 'a996edc05e91cb39191c0517c99e287dccb47f8e205c69e0fd06302e402c5a9f', files: 'e2e/finish-queue.spec.ts | e2e/finish-review.spec.ts' },
  { hash: '0a00586d7e0a290ea90ef746232437421ac829567b2be35f768b7f07bd1ba4cf', files: 'e2e/finish-queue.spec.ts | packages/server/src/finish-flags.test.ts; e2e/finish-queue.spec.ts | packages/server/src/ws.test.ts' },
  { hash: '811e092bf1c4eb86253fdeda5411195f2230efab22f6b6bdb21db3c03be3367a', files: 'e2e/finish-queue.spec.ts | packages/server/src/headers.test.ts; e2e/finish-queue.spec.ts | packages/server/src/retention.test.ts' },
  { hash: '2d7c2d97fca5019d9e199071ff12aa81e087241c2c6dca265d168c495f6f4598', files: 'e2e/finish-queue.spec.ts | packages/server/src/consent.test.ts' },
  { hash: 'fb5775dc0cfb3ac5889bdbbe8a7a52aeccea3181910f0d210a4314402fcfa072', files: 'e2e/kuulan-holkka.spec.ts | e2e/kuulan-holkka.spec.ts' },
  { hash: '962d4c71ce442035432381e663a71e06887651abe75164d52007f3b24d0ac0fa', files: 'e2e/preview.spec.ts | e2e/server.ts' },
  { hash: 'f0cb8a03b980fd03adef141d8d780c78ed332bcd1c40b8d9600db604acaddcd6', files: 'packages/server/src/auth.test.ts | packages/server/src/auth.test.ts' },
  { hash: '09fcc37d341c904d701445a76a6b873468ec1bb8c03d20fc1d4a80bf96034d50', files: 'packages/server/src/auth.test.ts | packages/server/src/setup-session.test.ts' },
  { hash: '5bb897d8ca43f2384f7c85123ed3ed17bd91bec9a49ea011bdd83e9e4c6cf658', files: 'packages/server/src/consent.test.ts | packages/server/src/privacy.test.ts' },
  { hash: '43b380bcfedcde2e6c5b92b81cb36431a2a8ead44ffb162a7c532acb19c129e1', files: 'packages/server/src/consent.test.ts | packages/server/src/race-file.test.ts' },
  { hash: 'e246323bca29bebd806cb4b12de96b2ebd4519cedea6ab9046692752093b2277', files: 'packages/server/src/consent.test.ts | packages/server/src/finish-flags.test.ts; packages/server/src/consent.test.ts | packages/server/src/ws.test.ts' },
  { hash: 'd7fbf3255ba681508bbdd3db5f6c5eed5a3b1ee824dbb73e482ab0ae8252cf60', files: 'packages/server/src/consent.test.ts | packages/server/src/privacy.test.ts' },
  { hash: '325f7628d30e69aa7f69e45f229632a4cfdb6213bb92b26374e084df7db4ac5e', files: 'packages/server/src/ertx-import.test.ts | packages/server/src/retention.test.ts' },
  { hash: '6499e073d6a859848fc3cb19f3f80a7a68d1d586035b1b698f8aa084da847c78', files: 'packages/server/src/finish-flags.test.ts | packages/server/src/finish-flags.test.ts' },
  { hash: 'ba40b8dd6ea6a92732930110cee6339315a0f78b93bc01f5cf9437f455d7f32b', files: 'packages/server/src/finish-flags.test.ts | packages/server/src/finish-flags.test.ts' },
  { hash: '88aa7e18b340f8278c3bf7874445dd2125907b35639974f4d28c4431999fda6a', files: 'packages/server/src/finish-flags.test.ts | packages/server/src/finish-flags.test.ts' },
  { hash: '160c1df36db9ef92a8bce4fea280c72f18ca870218450d2410c62d8a4f0c81bc', files: 'packages/server/src/finish-flags.test.ts | packages/server/src/rate-limit.test.ts' },
  { hash: '20f476bca920cf27fff11c2b1c33d32e4bdf06b037e298fea63633c6829abbc7', files: 'packages/server/src/finish-flags.test.ts | packages/server/src/retention.test.ts' },
  { hash: 'a8fc7754828e741dee8ff038689a7b778456eab760ee40f53f95b6393ac55d41', files: 'packages/server/src/privacy.test.ts | packages/server/src/privacy.test.ts' },
  { hash: '90002e66744d9cb67a3987d03d936a1a79a9e94987535b8d6fcfa589c59532ee', files: 'packages/server/src/race-file.test.ts | packages/storage/src/cipher.test.ts' },
  { hash: '60330f17cb1f0c3e2e63bae0110a65559011de2c250cbb5fb65fffd0d6ee3483', files: 'packages/server/src/retention.test.ts | packages/server/src/retention.test.ts' },
  { hash: '728d88b7037d04f6c828fb60a586c415699ed44a6c294d4924d8d8dd25c5ea87', files: 'packages/server/src/retention.test.ts | packages/server/src/retention.test.ts' },
  { hash: '05bc1c19980a0d95919ab6536c792770bce99b169c9f34632b74cf1673550f8d', files: 'packages/server/src/scenario.test.ts | packages/server/src/scenario.test.ts' },
  { hash: '0cc6f4b8c8228d7e3c42acb03d1a4776351bd6406f3d5b4f6a8a0a99ff22a662', files: 'packages/server/src/ws.test.ts | packages/server/src/ws.test.ts' },
  { hash: '6f169dc3944a8c19de82a153f0f7f3720ed026c2bcc8b0dc740a798713163365', files: 'packages/server/src/ws.test.ts | packages/server/src/ws.test.ts' },
  { hash: 'c0671d58613d06f38ddfd68b0fe7f7dc90328aa59d893c061ee840d9cc5e17a8', files: 'packages/server/src/ws.test.ts | packages/server/src/ws.test.ts' },
  { hash: 'b3c0765524174797e33e842ea1ddbf90a9bccfb0538058e840694a6287882bc0', files: 'packages/storage/src/cipher.test.ts | packages/storage/src/cipher.test.ts' },
  { hash: 'e57df36a8f233c45eeed023eec435f4c6005b63adbf92623ddc48b08af0fe4ec', files: 'packages/storage/src/cipher.test.ts | packages/storage/src/cipher.test.ts' },
  { hash: 'd4745829d6633ffaa212e122a20a2d85168cad789f7e2495947d4ff307536fb4', files: 'packages/web/src/live-session.test.ts | packages/web/src/live-session.test.ts' },

]
