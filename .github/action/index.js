const { Octokit } = require("@octokit/action");
const fetch = require("node-fetch");
const core = require('@actions/core');

core.getInput('Issue_ID');
const organizationLogin = core.getInput('GITHUB_REPOSITORY_OWNER');
const token = core.getInput('GITHUB_TOKEN');
const art = "Bearer "+token;
const octokit = new Octokit({
  auth: token,
});
const githubApiEndpoint = "https://api.github.com/graphql";

// 提pr用的
// const organizationLogin = "matrixorigin";
async function run() {
  try {
    const issueNumber = core.getInput('Issue_ID');
    // 获取 issue 的详细信息
    const owner_repo = core.getInput('GITHUB_REPOSITORY');
    console.log(owner_repo);
    const parts = owner_repo.split('/');
    console.log(owner_repo);
    console.log(parts[0]);
    console.log(parts[1]);
    const issue = await octokit.rest.issues.get({
      owner: parts[0],
      repo: parts[1],         
      issue_number: issueNumber,
    });
    // 获取assignees列表
    const assignees = issue.data.assignees;
    // 获取issue的node_id
    const issue_node_id = issue.data.node_id;
    // graphql header
    const headers = {
        'Authorization': art,
        'Content-Type': 'application/json',
      };
    // 获取当前issue所在project的信息
    var query = `
        query {
          repository(owner:"${organizationLogin}", name:"${parts[1]}") {
            issue(number:${issueNumber}) {
              projectItems(first:10,includeArchived:false){
                nodes{
                  ... on ProjectV2Item{
                    id
                    project{
                      id
                      title
                    }
                  }
                }
              }
          }
        }
        }
      `;
    var options = {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ query }),
        };
    const resp_add = await fetch(githubApiEndpoint, options);
    const resp_add_json = await resp_add.json();
    // 关键信息的list
    const issue_list = resp_add_json.data.repository.issue.projectItems.nodes;
    const m1 = new Map();
    if (assignees.length === 0) {
      console.log("Issue 没有 assignee，不进行项目关联");
      return;
    }
    const projectMapping = {
      'c1': 1,
      'c2': 2,
      'c4': 4,
    };
    const issue_item_id = [];
    for(const iss of issue_list){
      issue_item_id.push(iss.project.id);
      m1.set(iss.project.id,iss.id);
    }
    console.log(m1);
    const projectsToAssociate = [];
    // 获取org下的team列表
    const teams = await octokit.rest.teams.list({
        org: organizationLogin,  
      });
    //判断team下是否包含某个成员,是就将映射的projectid放到projectsToAssociate里
    for(const team_data of teams.data){
      const team_member = await octokit.rest.teams.listMembersInOrg({
            org: organizationLogin,
            team_slug: team_data.slug,
          });
      // console.log("team_member",team_member);
      for(const assignee of assignees){
        if(team_member.data.find((m) => m.login === assignee.login)){
          if(projectMapping[team_data.slug]){
            projectsToAssociate.push(projectMapping[team_data.slug]);
            console.log("成功push一个信息");
          }
        }
      }
    }

    result = Array.from(new Set(projectsToAssociate));
    console.log(result);
    
    if (result.length === 0 || (result.length === 1 && result.includes(4))) {
      console.log("没有team，放到默认project下");
      result.push(3); 
    }
    // 去重，获取的projectid可能有重复，因为一个assignee可以在多个的team下，
    flag = true;
    if(result.includes(4)){
      console.log("包含4，flag设置为false");
      flag = false;
      result = result.filter(item => item !== 4);
    }
    console.log("flag=",flag);
    const projectID_list = [];
    for(const projectId of result){
      var query = `
        query {
          organization(login: "${organizationLogin}") {
            projectV2(number: ${projectId}) {
              id
            }
          }
        }
      `;
      var options = {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ query }),
        };
      let pid;   // 存node-id
      // 获取node-id的请求
      const resp = await fetch(githubApiEndpoint, options);
      const resp_json = await resp.json();
      pid = resp_json.data.organization.projectV2.id;
      projectID_list.push(pid);
      console.log(pid);
    }
    let union_list = projectID_list.filter(v => issue_item_id.includes(v));
    console.log(union_list);
    let diff_del = issue_item_id.concat(union_list).filter(v => !issue_item_id.includes(v) || !union_list.includes(v));
    let diff_add = projectID_list.concat(union_list).filter(v => !projectID_list.includes(v) || !union_list.includes(v));
    console.log("删除差集中的item");
    console.log("diff_del",diff_del);
    console.log(diff_del.length !== 0 && flag);
    if(diff_del.length !== 0 && flag){
        for(const pid of diff_del){
        const del_item_id = m1.get(pid);
        var query=`
            mutation{
              deleteProjectV2Item(input:{projectId: \"${pid}\" itemId: \"${del_item_id}\" }){
                  deletedItemId  
                  }
            }
          `;
        var options = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ query }),
          };
        // 把不相关的project中删除issue
        await fetch(githubApiEndpoint, options);
        console.log("success delete item");
      }
    }
    console.log("插入item");
    console.log("diff_add",diff_add);
    console.log(diff_add.length !== 0 && flag);
    if(diff_add.length !== 0){
        for (const pid of diff_add) {
        // 通过graphql向project插入issue的query
        var query=`
            mutation{
              addProjectV2ItemById(input:{projectId: \"${pid}\" contentId: \"${issue_node_id}\" }){
                  item  {
                     id   
                    }
                  }
            }
          `;
        var options = {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ query }),
          };
        // 向project中插入issue
        const resp_add = await fetch(githubApiEndpoint, options);
        const resp_add_json = await resp_add.json();
        let add_item_id = resp_add_json.data.addProjectV2ItemById.item.id;
        console.log("issue_node_id=",issue_node_id);
        console.log("item_id=",add_item_id);
        console.log("success");
      }
    }
  } catch (error) {
    console.log(error.message)
  }
}

run();
