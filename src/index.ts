import { main } from './app.js';

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
