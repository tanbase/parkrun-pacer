/*
parkrun Results Page Saver Bookmarklet
======================================

Installation:
1. Copy all the minified code below
2. Create a new bookmark in your browser
3. Paste the code as the bookmark URL/Address

Usage:
Navigate to any parkrun results page and click the bookmark.
It will save the page automatically with filename format:
{course}-{event}-{date}.html  (example: albertmelbourne-684-20260411.html)
*/

// Minified bookmarklet code:
javascript:(function()%7Bconst%20u%3Dwindow.location.pathname.split('%2F')%3Bconst%20c%3Du.length%3E2%3Fu%5B1%5D%3A'unknown'%3Bconst%20e%3Du.length%3E4%3Fu%5B3%5D%3A'0'%3Bconst%20d%3Ddocument.querySelector('%23content%20div.Results%20div.Results-header%20h3%20span.format-date')%3Blet%20ds%3D''%3Bif(d)%7Bconst%20m%3Dd.textContent.match(%2F(%5Cd%7B1%2C2%7D)%5C%2F(%5Cd%7B1%2C2%7D)%5C%2F(%5Cd%7B2%7D)%2F)%3Bif(m)%7Bconst%20da%3Dm%5B1%5D.padStart(2%2C'0')%3Bconst%20mo%3Dm%5B2%5D.padStart(2%2C'0')%3Bconst%20y%3D'20'%2Bm%5B3%5D%3Bds%3D%60-%24%7By%7D%24%7Bmo%7D%24%7Bda%7D%60%7D%7Dconst%20f%3D%60%24%7Bc%7D-%24%7Be%7D%24%7Bds%7D.html%60%3Bconst%20h%3Ddocument.documentElement.outerHTML%3Bconst%20b%3Dnew%20Blob(%5Bh%5D%2C%7Btype%3A'text%2Fhtml'%7D)%3Bconst%20l%3Ddocument.createElement('a')%3Bl.href%3DURL.createObjectURL(b)%3Bl.download%3Df%3Bl.style.display%3D'none'%3Bdocument.body.appendChild(l)%3Bl.click()%3BsetTimeout(()%3D%3E%7Bdocument.body.removeChild(l)%3BURL.revokeObjectURL(l.href)%7D%2C100)%7D)()

/* -------------------------------------------------------------------------- */

// Human readable source code:

/*
(function() {
    // Extract course and event number from URL
    const parts = window.location.pathname.split('/');
    const course = parts.length > 2 ? parts[1] : 'unknown';
    const event = parts.length > 4 ? parts[3] : '0';

    // Extract date from page - exact selector provided
    const dateElement = document.querySelector('#content div.Results div.Results-header h3 span.format-date');
    
    let dateSuffix = '';

    if (dateElement) {
        // Match date format: d/m/yy (example: 11/4/26)
        const match = dateElement.textContent.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
        
        if (match) {
            const day = match[1].padStart(2, '0');
            const month = match[2].padStart(2, '0');
            const year = '20' + match[3];
            dateSuffix = `-${year}${month}${day}`;
        }
    }

    // Build filename
    const filename = `${course}-${event}${dateSuffix}.html`;

    // Save complete page
    const html = document.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }, 100);
})();
*/