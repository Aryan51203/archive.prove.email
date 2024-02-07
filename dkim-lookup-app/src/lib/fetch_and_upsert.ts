import dns from 'dns';
import { Prisma, PrismaClient, Selector, DkimRecord } from '@prisma/client'
import { prisma } from './db';

let resolver = new dns.promises.Resolver({ timeout: 2500 });

interface DnsDkimFetchResult {
	domain: string;
	selector: string;
	value: string;
	timestamp: Date;
}

function selectorToString(selector: Selector): string {
	return `#${selector.id}, ${selector.domain}, ${selector.name}`;
}

function recordToString(record: DkimRecord): string {
	let value = record.value;
	const maxLen = 50;
	let valueTruncated = (value.length > maxLen) ? value.slice(0, maxLen - 1) + '…' : value;
	return `#${record.id}, "${valueTruncated}"`;
}

async function updateSelectorTimestamp(selector: Selector, timestamp: Date) {
	let updatedSelector = await prisma.selector.update({
		where: {
			id: selector.id
		},
		data: {
			lastRecordUpdate: timestamp
		}
	})
	console.log(`updated selector timestamp ${selectorToString(updatedSelector)}`);
}

async function findOrCreateSelector(domain: string, selector: string): Promise<Selector> {
	let currentSelector = await prisma.selector.findFirst({
		where: {
			domain: {
				equals: domain,
				mode: Prisma.QueryMode.insensitive,
			},
			name: {
				equals: selector,
				mode: Prisma.QueryMode.insensitive
			}
		}
	});
	if (currentSelector) {
		console.log(`found selector ${selectorToString(currentSelector)}`);
	}
	else {
		currentSelector = await prisma.selector.create({
			data: {
				domain: domain,
				name: selector
			}
		})
		console.log(`created selector ${selectorToString(currentSelector)}`);
	}
	return currentSelector;
}

export async function upsertRecord(selectorInDb: Selector, newRecord: DnsDkimFetchResult): Promise<boolean> {
	console.log(`upserting record, ${newRecord.selector}, ${newRecord.domain}`);
	let currentRecord = await prisma.dkimRecord.findFirst({
		where: {
			selector: selectorInDb,
			value: newRecord.value
		},
	})
	if (currentRecord) {
		console.log(`record already exists: ${recordToString(currentRecord)} for selector ${selectorToString(selectorInDb)}`);
		return false;
	}
	console.log(`creating record for selector ${selectorToString(selectorInDb)}`);

	let dkimRecord = await prisma.dkimRecord.create({
		data: {
			selectorId: selectorInDb.id,
			value: newRecord.value,
			fetchedAt: newRecord.timestamp,
		},
	})
	console.log(`created dkim record ${recordToString(dkimRecord)} for selector ${selectorToString(selectorInDb)}`);
	return true;
}


export async function fetchRecord(domain: string, selector: string): Promise<DnsDkimFetchResult | null> {
	const qname = `${selector}._domainkey.${domain}`;
	let response;
	try {
		response = await resolver.resolve(qname, 'TXT');
	}
	catch (error) {
		console.log(`error fetching ${qname}: ${error}`);
		return null;
	}
	if (response.length === 0) {
		console.log(`warning: no records found for ${qname}`);
		return null;
	}
	if (response.length > 1) {
		console.log(`warning: > 1 record found for ${qname}, using first one`);
	}
	console.log(`found dns record for ${qname}`);
	const dkimData = response[0].join('');
	const dkimRecord: DnsDkimFetchResult = {
		selector,
		domain,
		value: dkimData,
		timestamp: new Date(),
	};
	return dkimRecord;
}

/**
 * @returns true iff a record was added
 */
export async function fetchAndUpsertRecord(domain: string, selector: string): Promise<boolean> {
	console.log(`fetching ${selector}._domainkey.${domain} from dns`);
	let dkimRecord = await fetchRecord(domain, selector);
	if (!dkimRecord) {
		console.log(`no record found for ${selector}, ${domain}`);
		return false;
	}
	let selectorInDb = await findOrCreateSelector(domain, selector);
	let added = await upsertRecord(selectorInDb, dkimRecord);
	console.log(`updating selector timestamp for ${selector}, ${domain}`);
	updateSelectorTimestamp(selectorInDb, new Date());
	return added;
}
