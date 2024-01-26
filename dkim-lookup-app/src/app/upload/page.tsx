"use client";

import { load_domains_and_selectors_from_tsv } from "@/lib/tsv";
import axios from "axios";
import React, { useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react"

export default function Page() {

	const [log, setLog] = React.useState<string[]>([]);
	const scrollDiv = useRef<HTMLInputElement>(null);
	const [selectedFile, setSelectedFile] = React.useState<File | undefined>();
	const [started, setStarted] = React.useState<boolean>(false);
	const { data: session, status } = useSession()

	const baseUrl = new URL('api/upsert_dkim_record', window.location.origin);

	if (status == "unauthenticated") {
		return <div>
			<p>You need to be signed in to use this page.</p>
			<button onClick={() => signIn()}>Sign in</button>
		</div>
	}
	if (status == "loading") {
		return <p>loading...</p>
	}

	function fileSelectCallback(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		setSelectedFile(file);
	}

	function logmsg(message: string) {
		console.log(message);
		setLog(log => [...log, message]);
		if (scrollDiv.current) {
			scrollDiv.current.scrollTop = scrollDiv.current.scrollHeight;
		}
	}

	function readFile(file: File) {
		return new Promise((resolve, reject) => {
			var fr = new FileReader();
			fr.onload = () => {
				resolve(fr.result)
			};
			fr.onerror = reject;
			fr.readAsText(file);
		});
	}

	async function uploadFile() {
		if (!selectedFile) {
			throw "no file selected";
		}
		let fileContent = await readFile(selectedFile);
		if (!fileContent || (typeof fileContent !== "string")) {
			throw "error: invalid file content:" + fileContent;
		}

		let domainSelectorPairs = load_domains_and_selectors_from_tsv(fileContent);

		logmsg(`starting upload to ${baseUrl}`);
		for (const { domain, selector } of domainSelectorPairs) {
			let url = new URL(baseUrl.toString());
			url.searchParams.set('domain', domain);
			url.searchParams.set('selector', selector);
			await axios.get(url.toString())
				.then(response => {
					console.log('response.data: ', response.data);
					logmsg(`${domain} ${selector} ${response.data.message}`);
					if (scrollDiv.current) {
						scrollDiv.current.scrollTop = scrollDiv.current.scrollHeight;
					}
				})
		}
	}

	async function startStopButton() {
		if (!started) {
			setStarted(true);
			try {
				await uploadFile();
				logmsg("upload complete");
			}
			catch (error) {
				logmsg("error: " + error);
			}
			finally {
				setStarted(false);
			}
		}
	}

	const startEnabled = selectedFile && !started;

	return (
		<div>
			{(status == "authenticated" && session?.user?.email) &&
				<div>
					<div>Signed in as {session?.user?.email}</div>
					<button onClick={() => signOut()}>Sign out</button>
				</div>
			}
			<p>
				Add records to the database by providing a TSV file with domains and selectors.
				This page will parse the file and add the records to the database via the <code>api/upsert_dkim_record</code> API.
			</p>
			<div>
				<div>Select a file:</div>
				<input type="file" onChange={fileSelectCallback} accept=".tsv,.txt" />
			</div>
			<p>
				<button disabled={!startEnabled} onClick={startStopButton}>
					{started ? "Running..." : "Start"}
				</button>
			</p>
			<div>
				<div>Log:</div>
				<div style={{
					overflowY: 'scroll',
					paddingBottom: '2rem',
					backgroundColor: 'white',
					borderStyle: 'inset',
					borderWidth: '2px',
					height: '50vh',
				}}
					ref={scrollDiv} >
					{log.map((line, index) =>
						<pre style={{ margin: 0 }} key={index}>{line}</pre>
					)}
				</div>

			</div>
		</div >
	)
}
