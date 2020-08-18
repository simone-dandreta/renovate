import { RenovateConfig } from '../../../config';
import { REPOSITORY_CHANGED } from '../../../constants/error-messages';
import { logger } from '../../../logger';
import { platform } from '../../../platform';
import { PrState } from '../../../types';
import { getAllRenovateBranches, isBranchModified } from '../../../util/git';

async function cleanUpBranches(
  { dryRun, pruneStaleBranches: enabled }: RenovateConfig,
  remainingBranches: string[]
): Promise<void> {
  for (const branchName of remainingBranches) {
    try {
      const pr = await platform.findPr({
        branchName,
        state: PrState.Open,
      });
      const branchIsModified = await isBranchModified(branchName);
      if (pr && !branchIsModified) {
        if (!pr.title.endsWith('- autoclosed')) {
          if (dryRun) {
            logger.info(
              `DRY-RUN: Would update pr ${pr.number} to ${pr.title} - autoclosed`
            );
          } else if (enabled === false) {
            logger.info(
              `PRUNING-DISABLED: Would update pr ${pr.number} to ${pr.title} - autoclosed`
            );
          } else {
            await platform.updatePr({
              number: pr.number,
              prTitle: `${pr.title} - autoclosed`,
            });
          }
        }
      }
      const closePr = true;
      logger.debug({ branch: branchName }, `Deleting orphan branch`);
      if (branchIsModified) {
        if (pr) {
          logger.debug(
            { prNo: pr?.number, prTitle: pr?.title },
            'Skip PR autoclosing'
          );
          if (dryRun) {
            logger.info(`DRY-RUN: Would add Autoclosing Skipped comment to PR`);
          } else {
            await platform.ensureComment({
              number: pr.number,
              topic: 'Autoclosing Skipped',
              content:
                'This PR has been flagged for autoclosing, however it is being skipped due to the branch being already modified. Please close/delete it manually or report a bug if you think this is in error.',
            });
          }
        }
      } else if (dryRun) {
        logger.info(`DRY-RUN: Would deleting orphan branch ${branchName}`);
      } else if (enabled === false) {
        logger.info(
          `PRUNING-DISABLED: Would deleting orphan branch ${branchName}`
        );
      } else {
        await platform.deleteBranch(branchName, closePr);
      }
      if (pr && !branchIsModified) {
        logger.info({ prNo: pr.number, prTitle: pr.title }, 'PR autoclosed');
      }
    } catch (err) /* istanbul ignore next */ {
      if (err.message !== REPOSITORY_CHANGED) {
        logger.warn({ err, branch: branchName }, 'Error pruning branch');
      }
    }
  }
}

export async function pruneStaleBranches(
  config: RenovateConfig,
  branchList: string[]
): Promise<void> {
  logger.debug('Removing any stale branches');
  logger.trace({ config }, `pruneStaleBranches`);
  logger.debug(`config.repoIsOnboarded=${config.repoIsOnboarded}`);
  if (!branchList) {
    logger.debug('No branchList');
    return;
  }
  let renovateBranches = await getAllRenovateBranches(config.branchPrefix);
  if (!renovateBranches?.length) {
    logger.debug('No renovate branches found');
    return;
  }
  logger.debug({ branchList, renovateBranches }, 'Branch lists');
  const lockFileBranch = `${config.branchPrefix}lock-file-maintenance`;
  renovateBranches = renovateBranches.filter(
    (branch) => branch !== lockFileBranch
  );
  const remainingBranches = renovateBranches.filter(
    (branch) => !branchList.includes(branch)
  );
  logger.debug(`remainingBranches=${remainingBranches}`);
  if (remainingBranches.length === 0) {
    logger.debug('No branches to clean up');
    return;
  }

  await cleanUpBranches(config, remainingBranches);
}
