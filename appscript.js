// author: Trinity Chung trinityc@berkeley.edu
// created: 9/3/2023

const IS_PROD = true;

const ED_HOST = "https://us.edstem.org/api";
const ED_TOKEN = "";

const ED_CLASS_ID_TEST = "24720";
const ED_CLASS_ID_PROD = "";

const REPO_TEST = ""
const REPO_PROD = "EE120-Course-Staff/ee120-course-staff.github.io";

const GH_TOKEN_TEST = ""
const GH_TOKEN_PROD = ""
const baseBranch = "main";
const branchName = "fourierbot";
const lecturesFile = "_data/lectures.yml";




function test() {
  // https://www.youtube.com/watch?v=yZpaTOFhJwc&list=PLnocShPlK-Ftt9ZPYTuagNaVg1xFJhCtp&index=3
  const e = {
    parameter: {
      youtubeID: "yZpaTOFhJwc",
      playlistID: "PLnocShPlK-Ftt9ZPYTuagNaVg1xFJhCtp",
      date: "2023-08-31T21:32:42Z",
      // videoTitle: "EE120 9/3/2023",
      testEd: true,
      testGithub: true,
    },
  };
  doGet(e);
}

function doGet(e) {
  console.log(e);

  const youtubeID = e.parameter["youtubeID"];
  const playlistID = e.parameter["playlistID"];
  const videoTitle = e.parameter["videoTitle"];
  const videoDate = e.parameter["date"];
  const testEd = e.parameter["testEd"] || !IS_PROD;
  const testGithub = e.parameter["testGithub"] || !IS_PROD;

  const lectureUrl = `https://www.youtube.com/watch?v=${youtubeID}&list=${playlistID}`;

  let dateStr;
  if (videoTitle) {
    const dateMatch = videoTitle.match(/\d+\/[\d/]+/g);
    dateStr = dateMatch[0];
  } else {
    const uploadDate = videoDate ? new Date(videoDate) : new Date();
    const mon = getLastDayOccurence(uploadDate, "Mon");
    const wed = getLastDayOccurence(uploadDate, "Wed");
    const date = wed > mon ? wed : mon;
    dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  console.log("lecture url   : " + lectureUrl);
  console.log("lecture date  : " + dateStr);
  console.log("using test Ed?: " + testEd);
  console.log("using test GH?: " + testGithub);

  const edUrl = postOnEd(dateStr, lectureUrl, testEd);
  const githubPRUrl = makeGithubPR(dateStr, lectureUrl, edUrl, testGithub);

  var output = ContentService.createTextOutput();
  output.append(`Successfully posted Lecture ${dateStr}! \n`);
  output.append(`Pull request for updating website: ${githubPRUrl} \n`);
  output.append(`Ed thread: ${edUrl}`);
  return output;
}

function makeGithubPR(dateStr, lectureUrl, edUrl, test = false) {
  // https://stackoverflow.com/questions/11801983/how-to-create-a-commit-and-push-into-repo-with-github-api-v3

  
  const repo = test
    ? REPO_TEST
    : REPO_PROD;
  const token = test ? GH_TOKEN_TEST : GH_TOKEN_PROD

  let response;
  let content;
  let json;
  const headers = {
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const optionsForPost = {
    method: "post",
    contentType: "application/json",
    headers: headers,
  };
  const optionsForGet = {
    method: "get",
    headers: headers,
  };

  // 0. get current file contents and generate new blob content
  // https://api.github.com/repos/<Project Name>/<Repository Name>/contents/<File Name>
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/contents/${lecturesFile}`,
    optionsForGet
  );
  json = JSON.parse(response.getContentText());
  content = Utilities.newBlob(
    Utilities.base64Decode(json["content"])
  ).getDataAsString();
  console.log(content);
  const lines = content.split("\n");
  let i = 0;
  let found = false;
  while (!found) {
    if (lines[i].trim() == "edThread:") {
      found = true;
    } else {
      i += 1;
    }
  }
  if (found) {
    lines[i] += " " + edUrl;
    lines[i + 1] += " " + lectureUrl;
  } else {
    console.log("Not sure where to update in file...");
    return;
  }
  const blobContent = lines.join("\n");
  console.log(
    "step 0: create new blob content:\n" + lines[i] + "\n" + lines[i + 1]
  );

  // 1. get latest sha
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/branches/${baseBranch}`,
    optionsForGet
  );
  json = JSON.parse(response.getContentText());
  const last_commit_sha = json["commit"]["sha"];
  console.log("step 1: got latest commit " + last_commit_sha);

  // 2.2. create branch
  const newBranchName = branchName + "-" + dateStr.replaceAll("/", "-");
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/git/refs`,
    {
      ...optionsForPost,
      payload: JSON.stringify({
        ref: `refs/heads/${newBranchName}`,
        sha: last_commit_sha,
      }),
    }
  );
  console.log("step 2.2: created branch " + newBranchName);

  // 2. create blob
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/git/blobs`,
    {
      ...optionsForPost,
      payload: JSON.stringify({ content: blobContent, encoding: "utf-8" }),
    }
  );
  json = JSON.parse(response.getContentText());
  const blob_sha = json["sha"];
  console.log("step 2: made blob sha " + blob_sha);

  // 3. make tree
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/git/trees`,
    {
      ...optionsForPost,
      payload: JSON.stringify({
        base_tree: last_commit_sha,
        tree: [
          {
            path: lecturesFile,
            mode: "100644",
            type: "blob",
            sha: blob_sha,
          },
        ],
      }),
    }
  );
  json = JSON.parse(response.getContentText());
  const tree_sha = json["sha"];
  console.log("step 3: made tree sha " + tree_sha);

  // 4. create commit
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/git/commits`,
    {
      ...optionsForPost,
      payload: JSON.stringify({
        message: last_commit_sha,
        author: {
          name: "FourierBot",
          email: "ee120-staff@berkeley.edu",
        },
        parents: [last_commit_sha],
        tree: tree_sha,
      }),
    }
  );
  json = JSON.parse(response.getContentText());
  const new_commit_sha = json["sha"];
  console.log("step 4: made commit sha " + new_commit_sha);

  // 5. make commit to branch
  response = UrlFetchApp.fetch(
    `https://api.github.com/repos/${repo}/git/refs/heads/${newBranchName}`,
    {
      ...optionsForPost,
      method: "patch",
      payload: JSON.stringify({
        sha: new_commit_sha,
      }),
    }
  );
  console.log("step 5: added commit to branch " + newBranchName);

  // 6. make pull request
  response = UrlFetchApp.fetch(`https://api.github.com/repos/${repo}/pulls`, {
    ...optionsForPost,
    payload: JSON.stringify({
      title: `FourierBot: ${dateStr} Lecture`,
      body: `This is pull request was created with Lecture Upload Automation!\nLecture: ${lectureUrl}\nEd: ${edUrl}`,
      head: newBranchName,
      base: baseBranch,
    }),
  });
  json = JSON.parse(response.getContentText());
  const pr_url = json["html_url"];
  console.log("step 6: created pull request at " + pr_url);

  return pr_url;
}

function postOnEd(dateStr, lectureUrl, test = false) {

  const ED_CLASS_ID = test ? ED_CLASS_ID_TEST : ED_CLASS_ID_PROD;

  let response, json, postData;
  const header = {
    Authorization: `Bearer ${ED_TOKEN}`,
  };
  const optionsForPost = {
    method: "post",
    contentType: "application/json",
    headers: header,
    // payload: JSON.stringify(postData),
  };
  const optionsForGet = {
    method: "get",
    headers: header,
  };

  // https://github.com/smartspot2/edapi/blob/f94334ab724a63f28ffcf966d518f97a0c2798f4/edapi/edapi.py#L221
  response = UrlFetchApp.fetch(
    `${ED_HOST}/courses/${ED_CLASS_ID}/threads?limit=100&offset=0&sort=new`,
    optionsForGet
  );
  json = JSON.parse(response.getContentText());
  const threads = json["threads"];
  const filtered = threads.filter(
    (t) => t.title.trim() === dateStr + " Lecture Thread"
  );
  if (filtered) {
    const thread = filtered[0];
    console.log(thread);

    const postData = {
      comment: {
        type: "comment",
        content:
          '<document version="2.0"><paragraph><pre>Recording has been posted:</pre> ' +
          lectureUrl.replaceAll("&", "&amp;") +
          "</paragraph></document>",
        is_private: false,
        is_anonymous: false,
      },
    };

    // https://us.edstem.org/api/comments/7745479/resolve

    response = UrlFetchApp.fetch(`${ED_HOST}/threads/${thread.id}/comments`, {
      ...optionsForPost,
      payload: JSON.stringify(postData),
    });
    json = JSON.parse(response.getContentText());
    console.log(json);
    const comment_id = json.comment.id;
    response = UrlFetchApp.fetch(
      `${ED_HOST}/comments/${comment_id}/resolve`,
      optionsForPost
    );
    return `https://edstem.org/us/courses/${ED_CLASS_ID}/discussion/${thread.id}`;
  } else {
    // make new post
    postData = {
      thread: {
        category: "Lecture",
        content: `<document version="2.0"><paragraph>Feel free to ask any conceptual questions about or discuss any content regarding the ${dateStr} Lecture below. <link href="${lectureUrl.replaceAll(
          "&",
          "&amp;"
        )}">Recording</link></paragraph></document>`,
        is_pinned: false,
        is_megathread: true,
        title: `${dateStr} Lecture Thread`,
        type: "post",
        anonymous_comments: true,
      },
    };
    response = UrlFetchApp.fetch(`${ED_HOST}/courses/${ED_CLASS_ID}/threads`, {
      ...optionsForPost,
      payload: JSON.stringify(postData),
    });
    json = JSON.parse(response.getContentText());
    return `https://edstem.org/us/courses/${ED_CLASS_ID}/discussion/${json.thread.id}`;
  }
}

// https://stackoverflow.com/questions/38985211/get-date-of-last-occurrence-of-a-specific-weekday-dynamically/59145062#59145062
function getLastDayOccurence(date, day) {
  const d = new Date(date.getTime());
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (days.includes(day)) {
    const modifier = (d.getDay() + days.length - days.indexOf(day)) % 7 || 7;
    d.setDate(d.getDate() - modifier);
  }
  return d;
}
