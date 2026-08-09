// Icons © Nucleo — sourced from the UI Essential Outline 18 and Social Media collections.
type IconElementBase = {
	fill?: 'none' | 'currentColor';
	fillRule?: 'evenodd' | 'nonzero';
	stroke?: boolean;
};

export type AppIconElement =
	| (IconElementBase & { type: 'path'; d: string })
	| (IconElementBase & { type: 'polyline'; points: string })
	| (IconElementBase & { type: 'line'; x1: string; y1: string; x2: string; y2: string })
	| (IconElementBase & {
			type: 'rect';
			x: string;
			y: string;
			width: string;
			height: string;
			rx?: string;
			ry?: string;
	  })
	| (IconElementBase & { type: 'circle'; cx: string; cy: string; r: string });

export type AppIconData = {
	viewBox: string;
	elements: readonly AppIconElement[];
	transform?: string;
};

const outlineIcon = (elements: readonly AppIconElement[], transform?: string): AppIconData => ({
	viewBox: '0 0 18 18',
	elements,
	transform
});

const socialIcon = (d: string, fillRule?: 'evenodd'): AppIconData => ({
	viewBox: '0 0 32 32',
	elements: [{ type: 'path', d, fill: 'currentColor', fillRule }]
});

export const assemblyIcon = outlineIcon([
	{ type: 'polyline', points: '14.983 5.53 9 9 3.017 5.53', stroke: true },
	{ type: 'line', x1: '9', y1: '15.938', x2: '9', y2: '9', stroke: true },
	{
		type: 'path',
		d: 'M7.997,2.332L3.747,4.797c-.617,.358-.997,1.017-.997,1.73v4.946c0,.713,.38,1.372,.997,1.73l4.25,2.465c.621,.36,1.386,.36,2.007,0l4.25-2.465c.617-.358,.997-1.017,.997-1.73V6.527c0-.713-.38-1.372-.997-1.73l-4.25-2.465c-.621-.36-1.386-.36-2.007,0Z',
		stroke: true
	}
]);

export const bookIcon = outlineIcon([
	{
		type: 'path',
		d: 'M9,15.051c.17,0,.339-.045,.494-.134,.643-.371,1.732-.847,3.141-.845,.899,.001,1.667,.197,2.27,.435,.648,.255,1.344-.24,1.344-.937V4.487c0-.354-.181-.68-.486-.86-.637-.376-1.726-.863-3.14-.863-1.89,0-3.198,.872-3.624,1.182',
		stroke: true
	},
	{
		type: 'path',
		d: 'M9,15.051c-.17,0-.339-.045-.494-.134-.643-.371-1.732-.847-3.141-.845-.899,.001-1.667,.197-2.27,.435-.648,.255-1.344-.237-1.344-.933,0-2.593,0-7.472,0-9.09,0-.354,.181-.676,.486-.856,.637-.376,1.726-.863,3.14-.863,1.89,0,3.198,.872,3.624,1.182h0s0,11.104,0,11.104Z',
		stroke: true
	}
]);

export const checkIcon = outlineIcon([
	{ type: 'polyline', points: '2.75 9.25 6.75 14.25 15.25 3.75', stroke: true }
]);

export const chevronRightIcon = outlineIcon([
	{ type: 'polyline', points: '6.5 2.75 12.75 9 6.5 15.25', stroke: true }
]);

export const closeIcon = outlineIcon([
	{ type: 'line', x1: '14', y1: '4', x2: '4', y2: '14', stroke: true },
	{ type: 'line', x1: '4', y1: '4', x2: '14', y2: '14', stroke: true }
]);

export const copyIcon = outlineIcon([
	{
		type: 'path',
		d: 'M13.75 5.25H7.25C6.145 5.25 5.25 6.145 5.25 7.25V13.75C5.25 14.855 6.145 15.75 7.25 15.75H13.75C14.855 15.75 15.75 14.855 15.75 13.75V7.25C15.75 6.145 14.855 5.25 13.75 5.25Z',
		stroke: true
	},
	{
		type: 'path',
		d: 'M12.4012 2.74998C12.0022 2.06148 11.2151 1.64837 10.38 1.77287L3.45602 2.80199C2.36402 2.96389 1.61003 3.98099 1.77203 5.07399L2.75002 11.6548',
		stroke: true
	}
]);

export const enterIcon = outlineIcon([
	{
		type: 'path',
		d: 'M2.75,8.25H13.25c1.105,0,2,.895,2,2v4',
		stroke: true
	},
	{ type: 'polyline', points: '7 12.5 2.75 8.25 7 4', stroke: true }
]);

export const externalLinkIcon = outlineIcon([
	{
		type: 'path',
		d: 'M4.25,9.25V3.75c0-1.105,.895-2,2-2h6c1.105,0,2,.895,2,2V13.25c0,1.105-.895,2-2,2H7.25',
		stroke: true
	},
	{ type: 'polyline', points: '7.24 6.75 11.25 6.75 11.25 10.76', stroke: true },
	{ type: 'line', x1: '11.25', y1: '6.75', x2: '1.75', y2: '16.25', stroke: true }
]);

export const githubIcon = socialIcon(
	'M16,2.345c7.735,0,14,6.265,14,14-.002,6.015-3.839,11.359-9.537,13.282-.7,.14-.963-.298-.963-.665,0-.473,.018-1.978,.018-3.85,0-1.312-.437-2.152-.945-2.59,3.115-.35,6.388-1.54,6.388-6.912,0-1.54-.543-2.783-1.435-3.762,.14-.35,.63-1.785-.14-3.71,0,0-1.173-.385-3.85,1.435-1.12-.315-2.31-.472-3.5-.472s-2.38,.157-3.5,.472c-2.677-1.802-3.85-1.435-3.85-1.435-.77,1.925-.28,3.36-.14,3.71-.892,.98-1.435,2.24-1.435,3.762,0,5.355,3.255,6.563,6.37,6.913-.403,.35-.77,.963-.893,1.872-.805,.368-2.818,.963-4.077-1.155-.263-.42-1.05-1.452-2.152-1.435-1.173,.018-.472,.665,.017,.927,.595,.332,1.277,1.575,1.435,1.978,.28,.787,1.19,2.293,4.707,1.645,0,1.173,.018,2.275,.018,2.607,0,.368-.263,.787-.963,.665-5.719-1.904-9.576-7.255-9.573-13.283,0-7.735,6.265-14,14-14Z'
);

export const menuIcon = outlineIcon([
	{ type: 'line', x1: '2.25', y1: '9', x2: '15.75', y2: '9', stroke: true },
	{ type: 'line', x1: '2.25', y1: '4.75', x2: '15.75', y2: '4.75', stroke: true },
	{ type: 'line', x1: '2.25', y1: '13.25', x2: '15.75', y2: '13.25', stroke: true }
]);

const darkLightElements: readonly AppIconElement[] = [
	{ type: 'path', d: 'M9,6v6c1.657,0,3-1.343,3-3s-1.343-3-3-3Z', fill: 'currentColor' },
	{
		type: 'path',
		d: 'M9,12c-1.657,0-3-1.343-3-3s1.343-3,3-3V1.75C4.996,1.75,1.75,4.996,1.75,9s3.246,7.25,7.25,7.25v-4.25Z',
		fill: 'currentColor'
	},
	{ type: 'circle', cx: '9', cy: '9', r: '7.25', stroke: true }
];

export const moonIcon = outlineIcon(darkLightElements, 'matrix(-1 0 0 1 18 0)');

export const moreHorizontalIcon = outlineIcon([
	{ type: 'circle', cx: '9', cy: '9', r: '.5', fill: 'currentColor', stroke: true },
	{ type: 'circle', cx: '3.25', cy: '9', r: '.5', fill: 'currentColor', stroke: true },
	{ type: 'circle', cx: '14.75', cy: '9', r: '.5', fill: 'currentColor', stroke: true }
]);

export const searchIcon = outlineIcon([
	{ type: 'path', d: 'M15.75 15.75L11.6386 11.6386', stroke: true },
	{
		type: 'path',
		d: 'M7.75 13.25C10.7875 13.25 13.25 10.7875 13.25 7.75C13.25 4.7125 10.7875 2.25 7.75 2.25C4.7125 2.25 2.25 4.7125 2.25 7.75C2.25 10.7875 4.7125 13.25 7.75 13.25Z',
		stroke: true
	}
]);

export const sunIcon = outlineIcon(darkLightElements);

export const tableOfContentsIcon = outlineIcon([
	{ type: 'line', x1: '15.25', y1: '9', x2: '2.75', y2: '9', stroke: true },
	{
		type: 'rect',
		x: '2.75',
		y: '2.75',
		width: '12.5',
		height: '12.5',
		rx: '2',
		ry: '2',
		stroke: true
	}
]);
