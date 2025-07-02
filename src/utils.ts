export const json = (d: any): Response =>
	new Response(JSON.stringify(d, null, 2), { headers: { 'Content-Type': 'application/json' } })

export const slugOf = (i: any): string => (i.slug?.trim() || i.fieldData?.slug?.trim() || '')
