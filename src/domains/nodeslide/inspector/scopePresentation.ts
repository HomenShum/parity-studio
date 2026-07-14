import type { PatchScope } from '../../../../shared/nodeslide';

export function nodeSlideScopeLabel(scope: PatchScope): string {
  if (scope.kind === 'deck') return 'Entire deck';
  if (scope.kind === 'slide') return countLabel(scope.slideIds.length, 'slide');
  if (scope.kind === 'elements') {
    return `${countLabel(scope.elementIds.length, 'element')} on ${countLabel(
      scope.slideIds.length,
      'slide',
    )}`;
  }
  if (scope.kind === 'bounding_box') {
    return `Bounding box on ${countLabel(scope.slideIds.length, 'slide')}`;
  }
  return `Comment ${scope.commentId}`;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
