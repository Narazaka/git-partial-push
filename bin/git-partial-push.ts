import { command, number, option, run, string } from "cmd-ts";

function genSpawnGit(cwd: string) {
  async function spawnGit(args: string[]) {
    console.log(`> git ${args.join(" ")}`);
    const { stdout, exited } = Bun.spawn(["git", ...args], { cwd });
    return {
      stdout: await Bun.readableStreamToText(stdout),
      exited: await exited,
    };
  }
  async function ifGit(args: string[]) {
    const { exited } = await spawnGit(args);
    return exited === 0;
  }
  async function git(args: string[]) {
    const { stdout, exited } = await spawnGit(args);
    if (exited !== 0) {
      throw new Error(`git ${args.join(" ")} exited with ${exited}`);
    }
    return stdout;
  }
  async function gitLines(args: string[]) {
    return (await git(args)).split(/\n/).filter(Boolean);
  }
  return {
    spawnGit,
    ifGit,
    git,
    gitLines,
  };
}

const defaultCwd = ".";
const defaultBatchSize = 30;

const program = command({
  name: "git-partial-push",
  args: {
    branch: option({
      type: string,
      long: "branch",
      short: "b",
      description: "git branch",
    }),
    remote: option({
      type: string,
      long: "remote",
      short: "r",
      description: "git remote",
    }),
    cwd: option({
      type: string,
      long: "cwd",
      short: "c",
      description: `working directory (default ${defaultCwd})`,
      defaultValue: () => defaultCwd,
    }),
    batchSize: option({
      type: number,
      long: "batch-size",
      short: "s",
      description: `batch size (default ${defaultBatchSize})`,
      defaultValue: () => defaultBatchSize,
    }),
  },
  handler: async ({ branch, remote, cwd, batchSize }) => {
    const { ifGit, git, gitLines } = genSpawnGit(cwd);
    const remoteExists = await ifGit([
      "show-ref",
      "--quiet",
      "--verify",
      `refs/remotes/${remote}/${branch}`,
    ]);
    const remoteHead = (
      await gitLines(["ls-remote", "--sort=committerdate", remote])
    )
      .reverse()[0]
      .split(/\s+/)[0];
    const remoteCommits = new Set(await gitLines(["rev-list", remoteHead]));
    const range = remoteExists ? `${remote}/${branch}..${branch}` : branch;
    const commits = (await gitLines(["rev-list", "--first-parent", range]))
      .reverse()
      .filter((commit) => !remoteCommits.has(commit));

    let i = batchSize;
    while (i < commits.length) {
      const commit = commits[i];
      await git(["push", remote, `${commit}:refs/heads/${branch}`]);
      i += batchSize;
    }
    await git([
      "push",
      remote,
      `${commits[commits.length - 1]}:refs/heads/${branch}`,
    ]);
  },
});

run(program, process.argv.slice(2));
